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

let net;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 9, 11, 0, 0));
  quota.setSleepFn(() => Promise.resolve());
  seedSession();
  net = stubFetch();
});

afterEach(() => vi.useRealTimers());

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
  it('reports connected, pending and none', async () => {
    await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'bobbright' });

    net.push(inviteAccepted); // ada: 1st degree
    net.push(profileView); // bob: 2nd degree, but we invited him
    net.push(profileView); // carla: 2nd degree, never contacted

    const res = await handle(ACTIONS.NETWORK_STATUS, {
      publicIds: ['adalovelace', 'bobbright', 'carlachen'],
    });
    expect(res.data.statuses).toEqual({
      adalovelace: 'connected',
      bobbright: 'pending',
      carlachen: 'none',
    });
  });

  it('emits invite_accepted when a pending invite has become a connection', async () => {
    const seen = [];
    const events = await import('../../src/background/events.js');
    events.setSink((f) => seen.push(f));
    await storage.logAction({ action: ACTIONS.OUTREACH_INVITE, publicId: 'adalovelace' });
    net.push(inviteAccepted);
    await handle(ACTIONS.NETWORK_STATUS, { publicIds: ['adalovelace'] });
    expect(seen.map((f) => f.event)).toContain('invite_accepted');
    events.setSink(null);
  });
});
