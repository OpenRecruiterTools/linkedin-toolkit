import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS, ERROR } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as events from '../../src/background/events.js';
import * as quota from '../../src/background/quota.js';
import * as queue from '../../src/background/queue.js';
import * as storage from '../../src/lib/storage.js';
import * as outreach from '../../src/background/outreach.js';
import { routeBackground, seedSession, status, stubFetch } from '../helpers/net.js';

import profileView from '../fixtures/voyager/profileView.json';
import inviteCreated from '../fixtures/voyager/inviteCreated.json';

let net;
let seen;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 9, 11, 0, 0));
  quota.setSleepFn(() => Promise.resolve());
  seedSession();
  net = routeBackground(stubFetch());
  seen = [];
  events.setSink((f) => seen.push(f));
});

afterEach(() => {
  events.setSink(null);
  vi.useRealTimers();
});

const invite = (origin, params = {}) =>
  handle(ACTIONS.OUTREACH_INVITE, { publicId: 'adalovelace', note: 'Hi Ada', ...params }, origin);

/** Queue the two answers one invite to a stranger needs: the urn, then the send. */
const queueInvite = () => {
  net.push(profileView);
  net.push(inviteCreated);
};

/**
 * Approve, then run the sender to completion.
 *
 * `queue.approve` only marks items now — the sending is a separate tick — so
 * every test that wants the outcome asks for it explicitly rather than relying
 * on a timer the fake clock would never fire.
 */
const approveAndSend = async (params, origin) => {
  const res = await handle(ACTIONS.QUEUE_APPROVE, params, origin);
  if (res.ok) await queue.sendApproved();
  return res;
};

const eventNames = () => seen.map((f) => f.event);

describe('origin rules', () => {
  it('popup sends directly', async () => {
    queueInvite();
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
    queueInvite();
    const res = await invite(origin);
    expect(res.data.status).toBe('sent');
    expect(await queue.list()).toHaveLength(0);
  });

  it('queueing does not consume quota; sending does', async () => {
    await invite('mcp');
    expect((await quota.snapshot('invite')).dailyUsed).toBe(0);

    queueInvite();
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
    queueInvite();

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
    queueInvite();
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
    net.push(inviteCreated); // the invite

    const res = await handle(ACTIONS.OUTREACH_INVITE, { publicId: 'adalovelace', note: 'Hi' }, 'popup');

    expect(res.ok).toBe(true);
    expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
    expect(net.calls[net.calls.length - 1].json.invitee.inviteeUnion.memberProfile).toContain('fsd_profile');
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
      net.push(inviteCreated); // the invite

      const res = await handle(
        ACTIONS.OUTREACH_INVITE,
        { publicId: 'adalovelace', note: 'Hi', profileUrn: 'urn:li:fsd_profile:HANDED_IN' },
        origin,
      );

      expect(res.data.status).toBe('sent');
      expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
      expect(net.calls[net.calls.length - 1].json.invitee.inviteeUnion.memberProfile).not.toContain('HANDED_IN');
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
      const payload = net.calls[net.calls.length - 1].json;
      expect(payload.hostRecipientUrns[0]).not.toContain('HANDED_IN');
    });

    it('a malformed urn cannot reach voyager unmetered', async () => {
      await setConfig({ autopilot: true });
      // Non-empty but nonsense: the old code would have passed it straight
      // through, and voyager's own fallback would have fetched for free.
      queueInvite();

      await handle(
        ACTIONS.OUTREACH_INVITE,
        { publicId: 'adalovelace', note: 'Hi', profileUrn: 'not-a-urn' },
        'cli',
      );

      expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
      expect(net.calls[net.calls.length - 1].json.invitee.inviteeUnion.memberProfile).not.toBe('not-a-urn');
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
    queueInvite();
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

  it('lists failed items too', async () => {
    const queued = await invite('mcp');
    net.push({ __status: 500, body: { message: 'boom' } });
    await approveAndSend({ ids: [queued.data.queueId] });

    const failed = (await handle(ACTIONS.QUEUE_LIST, { status: 'failed' })).data.items;
    expect(failed).toHaveLength(1);
    expect(failed[0].result.error.message).toMatch(/boom|500/);
  });

  it('approve marks the item and the sender sends it', async () => {
    const queued = await invite('mcp');
    queueInvite();

    const res = await approveAndSend({ ids: [queued.data.queueId] });
    expect(res.data).toEqual({ approved: 1 });

    const items = await queue.list();
    expect(items[0].status).toBe('sent');
    expect(items[0].result.status).toBe('sent');
    expect(eventNames()).toContain('queue_item_sent');
    expect((await quota.snapshot('invite')).dailyUsed).toBe(1);
  });

  it('approve applies note and body edits before sending', async () => {
    const queued = await invite('mcp');
    queueInvite();

    await approveAndSend({
      ids: [queued.data.queueId],
      edits: { [queued.data.queueId]: { note: 'Edited note' } },
    });

    const body = net.calls[net.calls.length - 1].json;
    expect(body.customMessage).toBe('Edited note');
  });

  it('the sender marks an item failed when the send throws, and keeps going', async () => {
    const a = await invite('mcp');
    const b = await invite('mcp', { publicId: 'bobbright' });

    net.push({ __status: 500, body: { message: 'boom' } });
    net.push(profileView);
    net.push(inviteCreated);

    const res = await approveAndSend({ ids: [a.data.queueId, b.data.queueId] });
    // Both were *approved*; only one of them sent.
    expect(res.data.approved).toBe(2);

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

describe('an agent cannot approve its own queue', () => {
  it('refuses queue.approve from mcp while autopilot is off', async () => {
    const queued = await invite('mcp');
    const res = await handle(ACTIONS.QUEUE_APPROVE, { ids: [queued.data.queueId] }, 'mcp');

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.UNAUTHORIZED);
    expect(res.error.message).toMatch(/Approval is a human action/);
    expect((await queue.list('pending'))).toHaveLength(1);
    expect(net.calls).toHaveLength(0);
  });

  it('refuses queue.reject from mcp while autopilot is off', async () => {
    const queued = await invite('mcp');
    const res = await handle(ACTIONS.QUEUE_REJECT, { ids: [queued.data.queueId] }, 'mcp');

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.UNAUTHORIZED);
    expect((await queue.list('pending'))).toHaveLength(1);
  });

  it('allows queue.approve from mcp once autopilot is on', async () => {
    const queued = await invite('mcp');
    await setConfig({ autopilot: true });
    queueInvite();

    const res = await approveAndSend({ ids: [queued.data.queueId] }, 'mcp');
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ approved: 1 });
  });

  it.each(['popup', 'cli'])('lets %s approve — both are a human deciding', async (origin) => {
    const queued = await invite('mcp');
    queueInvite();

    const res = await approveAndSend({ ids: [queued.data.queueId] }, origin);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ approved: 1 });
  });

  it.each(['popup', 'cli'])('lets %s reject', async (origin) => {
    const queued = await invite('mcp');
    const res = await handle(ACTIONS.QUEUE_REJECT, { ids: [queued.data.queueId] }, origin);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ rejected: 1 });
  });
});

/* ================================================================== */

/**
 * Issue #21: approving three invitations returned nothing over the bridge for
 * more than 60 seconds while the sends carried on behind it. Approving and
 * sending are two separate things now, and these are the tests that say so.
 */
describe('approve returns before anything is sent', () => {
  it('marks items approved and calls LinkedIn not at all', async () => {
    const a = await invite('mcp');
    const b = await invite('mcp', { publicId: 'bobbright' });

    const res = await handle(ACTIONS.QUEUE_APPROVE, { ids: [a.data.queueId, b.data.queueId] });

    expect(res.data).toEqual({ approved: 2 });
    expect(net.calls).toHaveLength(0);
    expect(await queue.list('approved')).toHaveLength(2);
    expect(await queue.list('sent')).toHaveLength(0);
    expect((await quota.snapshot('invite')).dailyUsed).toBe(0);
  });

  it('does not wait for the pacing delay', async () => {
    // A delay long enough that a synchronous send could not possibly have
    // finished: if approve waited for it, this test would hang.
    let waited = false;
    quota.setSleepFn(() => {
      waited = true;
      return Promise.resolve();
    });

    const queued = await invite('mcp');
    await handle(ACTIONS.QUEUE_APPROVE, { ids: [queued.data.queueId] });
    expect(waited).toBe(false);

    queueInvite();
    await queue.sendApproved();
    expect(waited).toBe(true);
  });

  it('the sender picks up everything approved, oldest first, one at a time', async () => {
    const a = await invite('mcp');
    const b = await invite('mcp', { publicId: 'bobbright' });
    await handle(ACTIONS.QUEUE_APPROVE, { ids: [a.data.queueId, b.data.queueId] });

    queueInvite();
    queueInvite();
    const out = await queue.sendApproved();

    expect(out).toEqual({ sent: 2, failed: 0, remaining: 0 });
    expect(await queue.list('sent')).toHaveLength(2);
    expect(eventNames().filter((e) => e === 'queue_item_sent')).toHaveLength(2);
  });

  it('an already-approved item is not approved twice', async () => {
    const queued = await invite('mcp');
    await handle(ACTIONS.QUEUE_APPROVE, { ids: [queued.data.queueId] });
    const again = await handle(ACTIONS.QUEUE_APPROVE, { ids: [queued.data.queueId] });
    expect(again.data).toEqual({ approved: 0 });
  });

  it('stops the drain on a stand-down and leaves the rest approved', async () => {
    const a = await invite('mcp');
    const b = await invite('mcp', { publicId: 'bobbright' });
    await handle(ACTIONS.QUEUE_APPROVE, { ids: [a.data.queueId, b.data.queueId] });

    net.push(status(429, {}));
    const out = await queue.sendApproved();

    expect(out.sent).toBe(0);
    expect(out.remaining).toBe(1);
    expect((await queue.list('approved'))).toHaveLength(1);
    expect((await queue.list('failed'))).toHaveLength(1);
  });

  it('two drains at once do not send the same item twice', async () => {
    const queued = await invite('mcp');
    await handle(ACTIONS.QUEUE_APPROVE, { ids: [queued.data.queueId] });
    queueInvite();

    const [first, second] = await Promise.all([queue.sendApproved(), queue.sendApproved()]);
    expect(first).toBe(second);
    expect(await queue.list('sent')).toHaveLength(1);
    expect(net.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('the 200-character note limit', () => {
  const long = 'x'.repeat(201);

  it('refuses an over-long note before anything is queued or spent', async () => {
    const res = await invite('mcp', { note: long });

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.INVALID_PARAMS);
    expect(res.error.howToFix).toBe('LinkedIn limits invitation notes to 200 characters.');
    expect(await queue.list()).toHaveLength(0);
    expect(net.calls).toHaveLength(0);
  });

  it('accepts exactly 200', async () => {
    queueInvite();
    const res = await invite('popup', { note: 'x'.repeat(200) });
    expect(res.ok).toBe(true);
  });

  it('refuses an edit that makes a queued item too long, and approves nothing', async () => {
    const queued = await invite('mcp');

    const res = await handle(ACTIONS.QUEUE_APPROVE, {
      ids: [queued.data.queueId],
      edits: { [queued.data.queueId]: { note: long } },
    });

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.INVALID_PARAMS);
    expect(res.error.howToFix).toBe('LinkedIn limits invitation notes to 200 characters.');
    // Nothing moved: the item is still pending, with its original note.
    const items = await queue.list('pending');
    expect(items).toHaveLength(1);
    expect(items[0].params.note).toBe('Hi Ada');
  });

  it('refuses the whole batch rather than approving the valid half', async () => {
    const a = await invite('mcp');
    const b = await invite('mcp', { publicId: 'bobbright' });

    const res = await handle(ACTIONS.QUEUE_APPROVE, {
      ids: [a.data.queueId, b.data.queueId],
      edits: { [b.data.queueId]: { note: long } },
    });

    expect(res.ok).toBe(false);
    expect(await queue.list('pending')).toHaveLength(2);
    expect(await queue.list('approved')).toHaveLength(0);
  });
});

describe('a reservation the engine refused itself is handed back', () => {
  it('releases the invite unit when our own validation stops the send', async () => {
    // Straight through `send`, past the engine's own param check, which is the
    // only way a validation failure can happen after the reservation.
    const before = (await quota.snapshot('invite')).dailyUsed;

    await expect(
      outreach.send(ACTIONS.OUTREACH_INVITE, {
        publicId: 'adalovelace',
        profileUrn: 'urn:li:fsd_profile:ACoAAAada',
        note: 'x'.repeat(201),
      }),
    ).rejects.toMatchObject({ code: ERROR.INVALID_PARAMS });

    expect((await quota.snapshot('invite')).dailyUsed).toBe(before);
    expect(net.calls).toHaveLength(0);
  });

  it('keeps it spent when LinkedIn is the one that refused', async () => {
    net.push(status(400, { data: { code: 'CANT_RESEND_YET', message: 'Already sent.' } }));

    await expect(
      outreach.send(ACTIONS.OUTREACH_INVITE, {
        publicId: 'adalovelace',
        profileUrn: 'urn:li:fsd_profile:ACoAAAada',
        note: 'Hi',
      }),
    ).rejects.toMatchObject({ code: ERROR.LINKEDIN_ERROR });

    expect((await quota.snapshot('invite')).dailyUsed).toBe(1);
  });
});
