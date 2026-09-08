import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS, ERROR } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as events from '../../src/background/events.js';
import * as quota from '../../src/background/quota.js';
import * as queue from '../../src/background/queue.js';
import * as storage from '../../src/lib/storage.js';
import '../../src/background/outreach.js';
import { seedSession, stubFetch } from '../helpers/net.js';

import profileView from '../fixtures/voyager/profileView.json';

let net;
let seen;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 9, 11, 0, 0));
  quota.setSleepFn(() => Promise.resolve());
  seedSession();
  net = stubFetch();
  seen = [];
  events.setSink((f) => seen.push(f));
});

afterEach(() => {
  events.setSink(null);
  vi.useRealTimers();
});

const invite = (origin, params = {}) =>
  handle(ACTIONS.OUTREACH_INVITE, { publicId: 'adalovelace', note: 'Hi Ada', ...params }, origin);

const eventNames = () => seen.map((f) => f.event);

describe('origin rules', () => {
  it('popup sends directly', async () => {
    net.push(profileView); // urn resolution
    net.push({});
    const res = await invite('popup');
    expect(res.data.status).toBe('sent');
    expect(await queue.list()).toHaveLength(0);
  });

  it.each(['campaign', 'mcp', 'cli'])('%s queues while autopilot is off', async (origin) => {
    const res = await invite(origin);
    expect(res.data.status).toBe('queued');
    expect(res.data.queueId).toBeTruthy();
    expect(net.calls).toHaveLength(0);

    const items = await queue.list('pending');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: ACTIONS.OUTREACH_INVITE, origin, status: 'pending' });
    expect(eventNames()).toContain('queue_item_added');
  });

  it.each(['campaign', 'mcp', 'cli'])('%s sends directly with autopilot on', async (origin) => {
    await setConfig({ autopilot: true });
    net.push(profileView);
    net.push({});
    const res = await invite(origin);
    expect(res.data.status).toBe('sent');
    expect(await queue.list()).toHaveLength(0);
  });

  it('queueing does not consume quota; sending does', async () => {
    await invite('mcp');
    expect((await quota.snapshot('invite')).dailyUsed).toBe(0);

    net.push(profileView);
    net.push({});
    await invite('popup');
    expect((await quota.snapshot('invite')).dailyUsed).toBe(1);
  });
});

describe('dry_run', () => {
  it.each(['popup', 'campaign', 'mcp', 'cli'])(
    'returns wouldSend with no quota and no queue for origin %s',
    async (origin) => {
      const res = await invite(origin, { dry_run: true });
      expect(res.data.status).toBe('dryRun');
      expect(res.data.wouldSend).toMatchObject({
        action: ACTIONS.OUTREACH_INVITE,
        params: { publicId: 'adalovelace', note: 'Hi Ada' },
      });
      expect(net.calls).toHaveLength(0);
      expect(await queue.list()).toHaveLength(0);
      expect((await quota.snapshot('invite')).dailyUsed).toBe(0);
    },
  );

  it('accepts the camelCase spelling too', async () => {
    const res = await invite('mcp', { dryRun: true });
    expect(res.data.status).toBe('dryRun');
  });
});

describe('the send path', () => {
  it('checks quota, paces, calls LinkedIn, records and logs', async () => {
    const delays = [];
    quota.setSleepFn((ms) => {
      delays.push(ms);
      return Promise.resolve();
    });
    net.push(profileView);
    net.push({});

    const res = await invite('popup');
    expect(res.data.status).toBe('sent');
    // Two pauses: the visit that resolves the profile urn, then the invite.
    expect(delays).toHaveLength(2);
    expect((await quota.snapshot('invite')).dailyUsed).toBe(1);
    expect((await quota.snapshot('visit')).dailyUsed).toBe(1);

    const log = await storage.allActions();
    expect(log[0]).toMatchObject({
      action: ACTIONS.OUTREACH_INVITE,
      publicId: 'adalovelace',
      origin: 'popup',
    });
    expect(log[0].result.status).toBe('sent');
  });

  it('refuses when the quota is spent, without calling LinkedIn', async () => {
    await setConfig({ accountPreset: 'free' });
    await quota.record('invite', 20);
    const res = await invite('popup');
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.QUOTA_EXCEEDED);
    expect(net.calls).toHaveLength(0);
  });

  it('reports the RateLimit on the envelope', async () => {
    net.push(profileView);
    net.push({});
    const res = await invite('popup');
    expect(res.rateLimit).toMatchObject({ dailyUsed: 1, dailyCap: 20 });
  });

  it('follow, like and view send directly whatever the origin', async () => {
    net.push(profileView);
    expect((await handle(ACTIONS.OUTREACH_VIEW, { publicId: 'adalovelace' }, 'mcp')).data.status).toBe(
      'sent',
    );
    net.push(profileView);
    net.push({});
    expect((await handle(ACTIONS.OUTREACH_FOLLOW, { publicId: 'adalovelace' }, 'mcp')).data.status).toBe(
      'sent',
    );
    net.push({});
    expect(
      (
        await handle(
          ACTIONS.OUTREACH_LIKE,
          { postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/' },
          'mcp',
        )
      ).data.status,
    ).toBe('sent');
    expect(await queue.list()).toHaveLength(0);
  });

  it('draws follow, like and view from the visit bucket and inmail from message', async () => {
    net.push(profileView);
    await handle(ACTIONS.OUTREACH_VIEW, { publicId: 'adalovelace' }, 'popup');
    expect((await quota.snapshot('visit')).dailyUsed).toBe(1);

    // The view already read the profile, so the follow reuses it for the urn
    // and only pays for its own visit.
    net.push({});
    await handle(ACTIONS.OUTREACH_FOLLOW, { publicId: 'adalovelace' }, 'popup');
    expect((await quota.snapshot('visit')).dailyUsed).toBe(2);

    net.push({});
    await handle(
      ACTIONS.OUTREACH_INMAIL,
      { publicId: 'adalovelace', subject: 'Role', body: 'Hello' },
      'popup',
    );
    expect((await quota.snapshot('message')).dailyUsed).toBe(1);
    expect((await quota.snapshot('visit')).dailyUsed).toBe(2);
  });

  it('a profile with no urn is read again, metered, rather than resolved for free', async () => {
    // A cached record from a search hit: no urn, and never profile-viewed.
    await storage.putProfile({ publicId: 'adalovelace', fullName: 'Ada Lovelace', urn: '' });

    net.push(profileView); // the metered read that actually has the urn
    net.push({}); // the invite

    const res = await handle(ACTIONS.OUTREACH_INVITE, { publicId: 'adalovelace', note: 'Hi' }, 'popup');

    expect(res.ok).toBe(true);
    expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
    expect(net.calls[net.calls.length - 1].json.inviteeProfileUrn).toContain('fsd_profile');
  });

  it('gives up rather than sending when no urn can be found at all', async () => {
    net.push({ included: [] }); // a profile read with nothing in it
    net.push({ included: [] }); // and the retry finds nothing either

    const res = await handle(ACTIONS.OUTREACH_INVITE, { publicId: 'ghost', note: 'Hi' }, 'popup');

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('NOT_FOUND');
    expect(net.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  describe('a client-supplied urn never bypasses metering', () => {
    it.each(['mcp', 'cli', 'campaign'])('strips profileUrn from a %s invite', async (origin) => {
      await setConfig({ autopilot: true });
      net.push(profileView); // the metered read the engine makes anyway
      net.push({}); // the invite

      const res = await handle(
        ACTIONS.OUTREACH_INVITE,
        { publicId: 'adalovelace', note: 'Hi', profileUrn: 'urn:li:fsd_profile:HANDED_IN' },
        origin,
      );

      expect(res.data.status).toBe('sent');
      expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
      expect(net.calls[net.calls.length - 1].json.inviteeProfileUrn).not.toContain('HANDED_IN');
    });

    it('strips recipientUrn from an agent message', async () => {
      await setConfig({ autopilot: true });
      net.push(profileView);
      net.push({});

      await handle(
        ACTIONS.OUTREACH_MESSAGE,
        { publicId: 'adalovelace', body: 'Hello', recipientUrn: 'urn:li:fsd_profile:HANDED_IN' },
        'mcp',
      );

      expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
      const payload = net.calls[net.calls.length - 1].json.conversationCreate;
      expect(payload.recipients[0]).not.toContain('HANDED_IN');
    });

    it('a malformed urn cannot reach voyager unmetered', async () => {
      await setConfig({ autopilot: true });
      // Non-empty but nonsense: the old code would have passed it straight
      // through, and voyager's own fallback would have fetched for free.
      net.push(profileView);
      net.push({});

      await handle(
        ACTIONS.OUTREACH_INVITE,
        { publicId: 'adalovelace', note: 'Hi', profileUrn: 'not-a-urn' },
        'cli',
      );

      expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
      expect(net.calls[net.calls.length - 1].json.inviteeProfileUrn).not.toBe('not-a-urn');
    });

    it('never lands in the queue item either', async () => {
      const res = await handle(
        ACTIONS.OUTREACH_INVITE,
        { publicId: 'adalovelace', note: 'Hi', profileUrn: 'urn:li:fsd_profile:HANDED_IN' },
        'mcp',
      );
      const item = (await queue.list('pending')).find((i) => i.id === res.data.queueId);
      expect(item.params.profileUrn).toBeUndefined();
    });

    it('the popup may still hand one in — one click, one action', async () => {
      net.push({});
      await handle(
        ACTIONS.OUTREACH_FOLLOW,
        { publicId: 'adalovelace', profileUrn: 'urn:li:fsd_profile:ACoAAAada' },
        'popup',
      );
      expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
      expect(net.calls).toHaveLength(1);
    });
  });

  it('a stranger costs exactly one visit for the whole invite', async () => {
    net.push(profileView); // the urn resolution
    net.push({}); // the invite
    await handle(ACTIONS.OUTREACH_INVITE, { publicId: 'stranger', note: 'Hi' }, 'popup');
    expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
    expect((await quota.snapshot('invite')).dailyUsed).toBe(1);
  });

  it('a caller that already has the urn is not charged a second visit', async () => {
    net.push({});
    await handle(
      ACTIONS.OUTREACH_FOLLOW,
      { publicId: 'adalovelace', profileUrn: 'urn:li:fsd_profile:ACoAAAada' },
      'popup',
    );
    expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
    expect(net.calls).toHaveLength(1);
  });
});

describe('queue.list / approve / reject', () => {
  it('lists by status', async () => {
    await invite('mcp');
    await invite('cli', { publicId: 'bobbright' });
    expect((await handle(ACTIONS.QUEUE_LIST, {})).data.items).toHaveLength(2);
    expect((await handle(ACTIONS.QUEUE_LIST, { status: 'pending' })).data.items).toHaveLength(2);
    expect((await handle(ACTIONS.QUEUE_LIST, { status: 'sent' })).data.items).toHaveLength(0);
  });

  it('approve executes the item and marks it sent', async () => {
    const queued = await invite('mcp');
    net.push(profileView);
    net.push({});

    const res = await handle(ACTIONS.QUEUE_APPROVE, { ids: [queued.data.queueId] });
    expect(res.data).toEqual({ approved: 1 });

    const items = await queue.list();
    expect(items[0].status).toBe('sent');
    expect(items[0].result.status).toBe('sent');
    expect(eventNames()).toContain('queue_item_sent');
    expect((await quota.snapshot('invite')).dailyUsed).toBe(1);
  });

  it('approve applies note and body edits before sending', async () => {
    const queued = await invite('mcp');
    net.push(profileView);
    net.push({});

    await handle(ACTIONS.QUEUE_APPROVE, {
      ids: [queued.data.queueId],
      edits: { [queued.data.queueId]: { note: 'Edited note' } },
    });

    const body = net.calls[net.calls.length - 1].json;
    expect(body.message).toBe('Edited note');
  });

  it('approve marks an item failed when the send throws, and keeps going', async () => {
    const a = await invite('mcp');
    const b = await invite('mcp', { publicId: 'bobbright' });

    net.push({ __status: 500, body: { message: 'boom' } });
    net.push(profileView);
    net.push({});

    const res = await handle(ACTIONS.QUEUE_APPROVE, {
      ids: [a.data.queueId, b.data.queueId],
    });
    expect(res.data.approved).toBe(1);

    const items = await queue.list();
    expect(items.find((i) => i.id === a.data.queueId).status).toBe('failed');
    expect(items.find((i) => i.id === b.data.queueId).status).toBe('sent');
  });

  it('reject marks items rejected and never sends', async () => {
    const queued = await invite('mcp');
    expect((await handle(ACTIONS.QUEUE_REJECT, { ids: [queued.data.queueId] })).data).toEqual({
      rejected: 1,
    });
    expect((await queue.list('rejected'))[0].id).toBe(queued.data.queueId);
    expect(net.calls).toHaveLength(0);
  });

  it('ignores unknown ids', async () => {
    expect((await handle(ACTIONS.QUEUE_APPROVE, { ids: ['nope'] })).data).toEqual({ approved: 0 });
    expect((await handle(ACTIONS.QUEUE_REJECT, { ids: ['nope'] })).data).toEqual({ rejected: 0 });
  });

  it('carries the profile snapshot so the UI can show who it is', async () => {
    await storage.putProfile({ publicId: 'adalovelace', fullName: 'Ada Lovelace' });
    await invite('mcp');
    expect((await queue.list())[0].profile.fullName).toBe('Ada Lovelace');
  });

  it('pendingCount feeds status.get', async () => {
    await invite('mcp');
    await invite('cli', { publicId: 'bobbright' });
    expect(await queue.pendingCount()).toBe(2);
  });
});
