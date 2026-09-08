import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS, ERROR } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as quota from '../../src/background/quota.js';
import * as storage from '../../src/lib/storage.js';
import '../../src/background/extract.js';
import { seedSession, stubFetch } from '../helpers/net.js';

import profileView from '../fixtures/voyager/profileView.json';
import searchClusters from '../fixtures/voyager/searchClusters.json';
import company from '../fixtures/voyager/company.json';
import companyEmployees from '../fixtures/voyager/companyEmployees.json';
import reactions from '../fixtures/voyager/reactions.json';
import connections from '../fixtures/voyager/connections.json';
import followers from '../fixtures/voyager/followers.json';
import groupMembers from '../fixtures/voyager/groupMembers.json';
import eventAttendees from '../fixtures/voyager/eventAttendees.json';
import inviteAccepted from '../fixtures/voyager/inviteAccepted.json';
import sentInvitations from '../fixtures/voyager/sentInvitations.json';

let net;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 9, 11, 0, 0));
  quota.setSleepFn(() => Promise.resolve());
  await setConfig({ accountPreset: 'recruiter' });
  seedSession();
  net = stubFetch();
});

afterEach(() => vi.useRealTimers());

/** A sent-invitations response listing these people as still pending. */
function sentInvitations2(publicIds) {
  return {
    elements: publicIds.map((publicId) => ({
      entityUrn: `urn:li:fs_invitation:${publicId}`,
      invitee: { miniProfile: { publicIdentifier: publicId } },
    })),
  };
}

describe('search.people', () => {
  it('returns contract profiles and stores them', async () => {
    net.push(searchClusters);
    const res = await handle(ACTIONS.SEARCH_PEOPLE, { keywords: 'analyst', count: 2 });
    expect(res.ok).toBe(true);
    expect(res.data.profiles.map((p) => p.publicId)).toEqual(['adalovelace', 'bobbright']);
    expect(res.data.total).toBe(240);
    expect((await storage.allProfiles()).length).toBe(2);
  });

  it('counts results, not calls, against the search quota', async () => {
    net.push(searchClusters);
    await handle(ACTIONS.SEARCH_PEOPLE, { keywords: 'analyst', count: 2 });
    expect((await quota.snapshot('search')).dailyUsed).toBe(2);
  });

  it('refuses when the daily search quota is spent', async () => {
    await setConfig({ accountPreset: 'free' });
    await quota.record('search', 300);
    const res = await handle(ACTIONS.SEARCH_PEOPLE, { keywords: 'analyst' });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.QUOTA_EXCEEDED);
    expect(net.calls).toHaveLength(0);
  });

  it('routes source=salesnav at the Sales Navigator API', async () => {
    net.push({ elements: [], paging: { total: 0 } });
    await handle(ACTIONS.SEARCH_PEOPLE, { keywords: 'cto', source: 'salesnav' });
    expect(net.calls[0].url).toContain('sales-api');
  });
});

describe('profile.get / profile.export', () => {
  it('fetches by publicId and by url', async () => {
    net.push(profileView);
    const byId = await handle(ACTIONS.PROFILE_GET, { publicId: 'adalovelace' });
    expect(byId.data.fullName).toBe('Ada Lovelace');

    net.push(profileView);
    const byUrl = await handle(ACTIONS.PROFILE_GET, {
      url: 'https://www.linkedin.com/in/adalovelace/',
    });
    expect(byUrl.data.publicId).toBe('adalovelace');
  });

  it('stores each profile it fetches', async () => {
    net.push(profileView);
    await handle(ACTIONS.PROFILE_GET, { publicId: 'adalovelace' });
    const stored = await storage.getStoredProfile('adalovelace');
    expect(stored.company).toBe('Analytical Engines');
    expect(typeof stored.updatedAt).toBe('number');
  });

  it('profile.export reports per-url failures without stopping', async () => {
    net.push(profileView);
    const res = await handle(ACTIONS.PROFILE_EXPORT, {
      urls: ['https://www.linkedin.com/in/adalovelace/', 'https://example.com/nope'],
    });
    expect(res.data.profiles).toHaveLength(1);
    expect(res.data.failed[0]).toMatchObject({ url: 'https://example.com/nope' });
  });
});

describe('company', () => {
  it('company.get accepts a url or a universalName', async () => {
    net.push(company);
    const byName = await handle(ACTIONS.COMPANY_GET, { universalName: 'analytical-engines' });
    expect(byName.data.name).toBe('Analytical Engines');

    net.push(company);
    const byUrl = await handle(ACTIONS.COMPANY_GET, {
      url: 'https://www.linkedin.com/company/analytical-engines/about/',
    });
    expect(byUrl.data.universalName).toBe('analytical-engines');
  });

  it('company.employees returns profiles', async () => {
    net.push(companyEmployees);
    const res = await handle(ACTIONS.COMPANY_EMPLOYEES, {
      universalName: 'analytical-engines',
      count: 10,
    });
    expect(res.data.profiles[0].publicId).toBe('carlachen');
  });
});

describe('audiences', () => {
  it('post.engagers marks the engagers as having engaged with a post', async () => {
    net.push(reactions);
    const res = await handle(ACTIONS.POST_ENGAGERS, {
      postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/',
      kind: 'likes',
    });
    expect(res.data.engagers[0].publicId).toBe('adalovelace');
    const stored = await storage.getStoredProfile('adalovelace');
    expect(stored.engagedWithPost).toBe(true);
  });

  it('group.members, event.attendees, connections and followers all return profiles', async () => {
    net.push(groupMembers);
    expect(
      (await handle(ACTIONS.GROUP_MEMBERS, { groupUrl: 'https://www.linkedin.com/groups/12345/' }))
        .data.profiles[0].publicId,
    ).toBe('erikericsson');

    net.push(eventAttendees);
    expect(
      (
        await handle(ACTIONS.EVENT_ATTENDEES, {
          eventUrl: 'https://www.linkedin.com/events/7000000000000000009/',
        })
      ).data.profiles[0].publicId,
    ).toBe('fatimafarouk');

    net.push(connections);
    expect((await handle(ACTIONS.NETWORK_CONNECTIONS, {})).data.profiles[0].publicId).toBe(
      'adalovelace',
    );

    net.push(followers);
    expect((await handle(ACTIONS.NETWORK_FOLLOWERS, {})).data.profiles[0].publicId).toBe(
      'danadupont',
    );
  });
});

describe('network.status', () => {
  it('reads pending straight off the sent-invitations collection, with no profile view', async () => {
    net.push(sentInvitations);
    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['bobbright', 'carlachen'] });

    expect(res.data.statuses).toEqual({ bobbright: 'pending', carlachen: 'pending' });
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].url).toContain('sentInvitationsV2');
    expect((await quota.snapshot('visit')).dailyUsed).toBe(0);
  });

  it('confirms an invitation that has left the pending list with one profile read', async () => {
    await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'adalovelace' });
    net.push({ elements: [] }); // nothing pending any more
    net.push(inviteAccepted); // …and they are 1st degree: a real acceptance

    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });
    expect(res.data.statuses).toEqual({ adalovelace: 'connected' });
    expect(net.calls).toHaveLength(2);
    expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
  });

  it('does not call a withdrawn or expired invitation an acceptance', async () => {
    const seen = [];
    const events = await import('../../src/background/events.js');
    events.setSink((f) => seen.push(f));

    await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'adalovelace' });
    net.push({ elements: [] }); // gone from the pending list
    net.push(profileView); // but still only 2nd degree

    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });
    expect(res.data.statuses).toEqual({ adalovelace: 'pending' });
    expect(seen.map((f) => f.event)).not.toContain('invite_accepted');
    events.setSink(null);
  });

  it('a message or a comment is not an invitation', async () => {
    await storage.logAction({ action: ACTIONS.OUTREACH_MESSAGE, publicId: 'adalovelace' });
    net.push({ elements: [] });
    net.push(profileView); // 2nd degree

    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });
    expect(res.data.statuses).toEqual({ adalovelace: 'none' });
  });

  it('falls back to a profile view for somebody we never invited, and meters it', async () => {
    net.push({ elements: [] }); // nothing pending
    net.push(inviteAccepted); // 1st degree
    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });

    expect(res.data.statuses).toEqual({ adalovelace: 'connected' });
    expect(net.calls).toHaveLength(2);
    expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
  });

  it('reports none for a stranger who is not a connection', async () => {
    net.push({ elements: [] });
    net.push(profileView); // 2nd degree
    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });
    expect(res.data.statuses).toEqual({ adalovelace: 'none' });
  });

  it('refuses more than 25 ids at a time', async () => {
    const publicIds = Array.from({ length: 26 }, (_, i) => `person${i}`);
    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.INVALID_PARAMS);
    expect(res.error.message).toMatch(/25/);
    expect(net.calls).toHaveLength(0);
  });

  it('accepts exactly 25', async () => {
    const publicIds = Array.from({ length: 25 }, (_, i) => `person${i}`);
    net.push({
      elements: publicIds.map((publicId) => ({ invitee: { miniProfile: { publicIdentifier: publicId } } })),
    });

    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds });
    expect(res.ok).toBe(true);
    expect(Object.keys(res.data.statuses)).toHaveLength(25);
    expect(net.calls).toHaveLength(1);
  });

  it('a batch of strangers stops reading at the hourly cap and says it is partial', async () => {
    await setConfig({ hourlyCap: 3 });
    net.push({ elements: [] });
    const publicIds = Array.from({ length: 25 }, (_, i) => `person${i}`);

    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds });

    expect(res.ok).toBe(true);
    expect(res.data.partial).toBe(true);
    expect(res.data.reason).toBe(ERROR.QUOTA_EXCEEDED);
    expect(Object.keys(res.data.statuses)).toHaveLength(25);
    // Three reads, then it stops rather than re-reserving for each of the rest.
    expect(net.calls.length).toBe(4); // the invitations call plus three reads
    expect(res.data.statuses.person24).toBe('none');
  });

  it('keeps what it resolved and calls unread invitations pending', async () => {
    await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'invited1' });
    await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'invited2' });
    await setConfig({ hourlyCap: 1 });

    net.push({ elements: [] }); // nothing pending
    net.push(inviteAccepted); // the one read we can afford

    const res = await handle(ACTIONS.NETWORK_STATUS, {
      publicIds: ['invited1', 'invited2', 'stranger'],
    });

    expect(res.ok).toBe(true);
    expect(res.data.partial).toBe(true);
    expect(res.data.statuses).toEqual({
      invited1: 'connected',
      invited2: 'pending',
      stranger: 'none',
    });
    expect(net.calls).toHaveLength(2);
  });

  it('emits invite_accepted once when a pending invite has landed', async () => {
    const seen = [];
    const events = await import('../../src/background/events.js');
    events.setSink((f) => seen.push(f));

    await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'adalovelace' });
    net.push({ elements: [] });
    net.push(inviteAccepted);
    await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });

    net.push({ elements: [] });
    await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });

    expect(seen.filter((f) => f.event === 'invite_accepted')).toHaveLength(1);
    events.setSink(null);
  });

  it('a read taken while the invitation was pending never answers the acceptance check', async () => {
    const seen = [];
    const events = await import('../../src/background/events.js');
    events.setSink((f) => seen.push(f));

    // The invite goes out…
    await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'adalovelace' });
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0, 0));

    // …and while it is still pending, a view step reads the profile: 2nd degree.
    net.push(sentInvitations2(['adalovelace']));
    expect(
      (await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] })).data.statuses,
    ).toEqual({ adalovelace: 'pending' });
    expect((await quota.snapshot('visit')).dailyUsed).toBe(0); // pending is free

    net.push(profileView);
    await handle(ACTIONS.PROFILE_GET, { publicId: 'adalovelace' }); // stamps degree 2
    expect((await storage.getStoredProfile('adalovelace')).connectionDegree).toBe(2);

    // An hour later the invitation is gone from the pending list.
    vi.setSystemTime(new Date(2026, 8, 9, 13, 0, 0));
    net.push({ elements: [] });
    net.push(inviteAccepted); // the refetch finds a first-degree connection

    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });

    expect(res.data.statuses).toEqual({ adalovelace: 'connected' });
    expect(seen.map((f) => f.event)).toContain('invite_accepted');
    // The stale degree-2 record did not answer: a fresh read was made.
    expect(net.calls.filter((c) => c.url.includes('/identity/profiles/'))).toHaveLength(2);
    expect((await quota.snapshot('visit')).dailyUsed).toBe(2);
    events.setSink(null);
  });

  it('a cached first-degree read still answers without another fetch', async () => {
    await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'adalovelace' });
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0, 0));

    net.push({ elements: [] });
    net.push(inviteAccepted);
    await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });
    const readsAfterFirst = net.calls.filter((c) => c.url.includes('/identity/profiles/')).length;

    net.push({ elements: [] });
    const again = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });

    expect(again.data.statuses).toEqual({ adalovelace: 'connected' });
    expect(net.calls.filter((c) => c.url.includes('/identity/profiles/'))).toHaveLength(
      readsAfterFirst,
    );
  });

  describe('when the invitations collection is unavailable', () => {
    /** LinkedIn moved the endpoint, or we are backed off. */
    function invitationsFail() {
      net.push({ __status: 404, body: {} });
    }

    it('never reports an unconfirmed invitation as connected', async () => {
      const seen = [];
      const events = await import('../../src/background/events.js');
      events.setSink((f) => seen.push(f));

      await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'adalovelace' });
      invitationsFail();
      net.push(profileView); // 2nd degree

      const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });
      expect(res.data.statuses).toEqual({ adalovelace: 'pending' });
      expect(seen.map((f) => f.event)).not.toContain('invite_accepted');
      events.setSink(null);
    });

    it('still confirms a genuine acceptance from the profile', async () => {
      await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'adalovelace' });
      invitationsFail();
      net.push(inviteAccepted);

      const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });
      expect(res.data.statuses).toEqual({ adalovelace: 'connected' });
    });

    it('reports pending, not connected, when the profile read is unavailable too', async () => {
      const seen = [];
      const events = await import('../../src/background/events.js');
      events.setSink((f) => seen.push(f));

      await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'adalovelace' });
      await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'bobbright' });
      await setConfig({ accountPreset: 'free' });
      await quota.record('visit', 80); // no visits left

      invitationsFail();
      const res = await handle(ACTIONS.NETWORK_STATUS, {
        publicIds: ['adalovelace', 'bobbright'],
      });

      expect(res.data.statuses).toEqual({ adalovelace: 'pending', bobbright: 'pending' });
      expect(res.data.partial).toBe(true);
      expect(seen.map((f) => f.event)).not.toContain('invite_accepted');
      events.setSink(null);
    });

    it('an endpoint that answers with a different shape reads as nothing pending, not as accepted', async () => {
      const seen = [];
      const events = await import('../../src/background/events.js');
      events.setSink((f) => seen.push(f));

      await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'adalovelace' });
      net.push({ data: { paging: { total: 3 } }, included: [] }); // shape LinkedIn changed
      net.push(profileView); // and the profile says 2nd degree

      const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });
      expect(res.data.statuses).toEqual({ adalovelace: 'pending' });
      expect(seen.map((f) => f.event)).not.toContain('invite_accepted');
      events.setSink(null);
    });
  });

  it('stops rather than firing 25 profile reads when the visit quota is spent', async () => {
    await setConfig({ accountPreset: 'free' });
    await quota.record('visit', 80);
    net.push({ elements: [] });

    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['a', 'b', 'c'] });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.QUOTA_EXCEEDED);
    expect(net.calls).toHaveLength(1);
  });
});

describe('profile reads are metered as visits', () => {
  it('profile.get reserves a visit and paces itself', async () => {
    const delays = [];
    quota.setSleepFn((ms) => {
      delays.push(ms);
      return Promise.resolve();
    });

    net.push(profileView);
    await handle(ACTIONS.PROFILE_GET, { publicId: 'adalovelace' });

    expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
    expect(delays).toHaveLength(1);
  });

  it('profile.get refuses when the visit quota is spent, without fetching', async () => {
    await setConfig({ accountPreset: 'free' });
    await quota.record('visit', 80);
    const res = await handle(ACTIONS.PROFILE_GET, { publicId: 'adalovelace' });
    expect(res.error.code).toBe(ERROR.QUOTA_EXCEEDED);
    expect(net.calls).toHaveLength(0);
  });

  it('profile.export meters every row and stops when the cap is hit', async () => {
    await setConfig({ accountPreset: 'free', dailyVisitCap: 2 });
    net.push(profileView);
    net.push(profileView);

    const res = await handle(ACTIONS.PROFILE_EXPORT, {
      urls: [
        'https://www.linkedin.com/in/a/',
        'https://www.linkedin.com/in/b/',
        'https://www.linkedin.com/in/c/',
        'https://www.linkedin.com/in/d/',
      ],
    });

    expect(res.data.profiles).toHaveLength(2);
    expect(res.data.failed).toHaveLength(1); // the third stops the run
    expect(res.data.failed[0].error).toMatch(/cap/i);
    expect(net.calls).toHaveLength(2);
    expect((await quota.snapshot('visit')).dailyUsed).toBe(2);
  });
});

describe('audience reads are metered against the search bucket', () => {
  it.each([
    [
      'post.engagers',
      ACTIONS.POST_ENGAGERS,
      { postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/', kind: 'likes' },
      reactions,
      1,
    ],
    ['group.members', ACTIONS.GROUP_MEMBERS, { groupUrl: 'https://www.linkedin.com/groups/12345/' }, groupMembers, 1],
    [
      'event.attendees',
      ACTIONS.EVENT_ATTENDEES,
      { eventUrl: 'https://www.linkedin.com/events/7000000000000000009/' },
      eventAttendees,
      1,
    ],
    ['network.connections', ACTIONS.NETWORK_CONNECTIONS, {}, connections, 1],
    ['network.followers', ACTIONS.NETWORK_FOLLOWERS, {}, followers, 1],
  ])('%s records its results', async (_name, action, params, fixture, expected) => {
    net.push(fixture);
    await handle(action, params);
    expect((await quota.snapshot('search')).dailyUsed).toBe(expected);
  });

  it('refuses an audience read when the search quota is spent', async () => {
    await setConfig({ accountPreset: 'free' });
    await quota.record('search', 300);
    const res = await handle(ACTIONS.NETWORK_CONNECTIONS, {});
    expect(res.error.code).toBe(ERROR.QUOTA_EXCEEDED);
    expect(net.calls).toHaveLength(0);
  });
});
