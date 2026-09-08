import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS, ERROR } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as quota from '../../src/background/quota.js';
import * as queue from '../../src/background/queue.js';
import * as storage from '../../src/lib/storage.js';
import '../../src/background/outreach.js';
import { seedSession, stubFetch } from '../helpers/net.js';

import profileView from '../fixtures/voyager/profileView.json';

let net;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 9, 11, 0, 0));
  quota.setSleepFn(() => Promise.resolve());
  seedSession();
  net = stubFetch();
  net.route('/identity/profiles/', profileView);
  await setConfig({ accountPreset: 'recruiter', businessHoursOnly: false, hourlyCap: 50 });
});

afterEach(() => vi.useRealTimers());

describe('the storage key lock', () => {
  it('serialises read-modify-write on the same key', async () => {
    await storage.set('counter', 0);
    await Promise.all(
      Array.from({ length: 20 }, () => storage.update('counter', (n) => n + 1, 0)),
    );
    expect(await storage.get('counter', 0)).toBe(20);
  });

  it('lets a different key run in parallel', async () => {
    await Promise.all([
      storage.update('a', () => 'A', null),
      storage.update('b', () => 'B', null),
    ]);
    expect(await storage.get('a')).toBe('A');
    expect(await storage.get('b')).toBe('B');
  });

  it('keeps the chain alive after a callback throws', async () => {
    await storage.set('counter', 0);
    await expect(
      storage.update('counter', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await storage.update('counter', (n) => n + 1, 0);
    expect(await storage.get('counter', 0)).toBe(1);
  });

  it('does not lose entries when the action log is written concurrently', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        storage.logAction({ action: ACTIONS.OUTREACH_VIEW, publicId: `p${i}` }),
      ),
    );
    expect(await storage.allActions()).toHaveLength(25);
  });
});

describe('quota.reserve is atomic', () => {
  it('two concurrent reserves at cap - 1 cannot both pass', async () => {
    await setConfig({ accountPreset: 'free', dailyInviteCap: 5, hourlyCap: 50 });
    await quota.record('invite', 4); // one left

    const results = await Promise.allSettled([
      quota.reserve('invite'),
      quota.reserve('invite'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected.reason.code).toBe(ERROR.QUOTA_EXCEEDED);
    expect((await quota.snapshot('invite')).dailyUsed).toBe(5);
  });

  it('ten concurrent reserves against a cap of three count exactly three', async () => {
    await setConfig({ accountPreset: 'free', dailyInviteCap: 3, hourlyCap: 50 });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => quota.reserve('invite')),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect((await quota.snapshot('invite')).dailyUsed).toBe(3);
  });

  it('two concurrent sends cannot take the account over a hard cap', async () => {
    await setConfig({ accountPreset: 'free', dailyInviteCap: 1, hourlyCap: 50 });
    net.push({});
    net.push({});

    const results = await Promise.allSettled([
      handle(ACTIONS.OUTREACH_INVITE, { publicId: 'adalovelace', note: 'a' }, 'popup'),
      handle(ACTIONS.OUTREACH_INVITE, { publicId: 'bobbright', note: 'b' }, 'popup'),
    ]);

    const envelopes = results.map((r) => r.value);
    expect(envelopes.filter((e) => e.ok)).toHaveLength(1);
    expect(envelopes.find((e) => !e.ok).error.code).toBe(ERROR.QUOTA_EXCEEDED);
    expect((await quota.snapshot('invite')).dailyUsed).toBe(1);
    expect(net.calls.filter((c) => c.url.includes('normInvitations'))).toHaveLength(1);
  });
});

describe('the queue survives concurrent writes', () => {
  it('keeps every item when several are enqueued at once', async () => {
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        handle(ACTIONS.OUTREACH_INVITE, { publicId: `p${i}`, note: 'Hi' }, 'mcp'),
      ),
    );
    expect(await queue.list('pending')).toHaveLength(15);
  });

  it('approving the same item twice sends it once', async () => {
    const queued = await handle(
      ACTIONS.OUTREACH_INVITE,
      { publicId: 'adalovelace', note: 'Hi' },
      'mcp',
    );
    net.push({});
    net.push({});

    const [first, second] = await Promise.all([
      handle(ACTIONS.QUEUE_APPROVE, { ids: [queued.data.queueId] }),
      handle(ACTIONS.QUEUE_APPROVE, { ids: [queued.data.queueId] }),
    ]);

    expect(first.data.approved + second.data.approved).toBe(1);
    expect(net.calls.filter((c) => c.url.includes('normInvitations'))).toHaveLength(1);
    expect((await queue.list())[0].status).toBe('sent');
  });
});
