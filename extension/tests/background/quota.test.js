import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ERROR, HARD_CAPS } from '../../src/lib/actions.js';
import { setConfig } from '../../src/lib/config.js';
import * as events from '../../src/background/events.js';
import * as quota from '../../src/background/quota.js';

/** A Wednesday at 11:00 local time — inside the default business window. */
const WEDNESDAY_11AM = new Date(2026, 8, 9, 11, 0, 0);
/** The Saturday of the same week, same hour. */
const SATURDAY_11AM = new Date(2026, 8, 12, 11, 0, 0);
/** Wednesday at 22:00 — outside the window. */
const WEDNESDAY_10PM = new Date(2026, 8, 9, 22, 0, 0);

function at(date) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(date);
}

beforeEach(() => {
  events.setSink(null);
  quota.setSleepFn(() => Promise.resolve());
  at(WEDNESDAY_11AM);
});

afterEach(() => {
  vi.useRealTimers();
});

async function caught(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

describe('presets', () => {
  it('matches the brief exactly', () => {
    expect(quota.PRESETS).toEqual({
      free: { invite: 20, message: 40, visit: 80, search: 300 },
      premium: { invite: 25, message: 60, visit: 120, search: 500 },
      salesnav: { invite: 30, message: 80, visit: 200, search: 800 },
      recruiter: { invite: 40, message: 100, visit: 300, search: 1000 },
    });
  });

  it('caps by preset when the preset is lower than the config', async () => {
    await setConfig({ accountPreset: 'free', dailyInviteCap: 100 });
    expect(await quota.dailyCapFor('invite')).toBe(20);

    await setConfig({ accountPreset: 'salesnav' });
    expect(await quota.dailyCapFor('invite')).toBe(30);
  });

  it('lets config win when it is lower than the preset', async () => {
    await setConfig({ accountPreset: 'recruiter', dailyInviteCap: 5 });
    expect(await quota.dailyCapFor('invite')).toBe(5);
  });

  it('never exceeds the hard caps whatever the preset or config asks for', async () => {
    await setConfig({
      accountPreset: 'recruiter',
      dailyInviteCap: 9999,
      dailyMessageCap: 9999,
      dailyVisitCap: 9999,
      dailySearchCap: 9999,
    });
    expect(await quota.dailyCapFor('invite')).toBeLessThanOrEqual(HARD_CAPS.dailyInviteCap);
    expect(await quota.dailyCapFor('message')).toBeLessThanOrEqual(HARD_CAPS.dailyMessageCap);
    expect(await quota.dailyCapFor('visit')).toBeLessThanOrEqual(HARD_CAPS.dailyVisitCap);
    expect(await quota.dailyCapFor('search')).toBe(HARD_CAPS.dailySearchCap);
  });
});

describe('warm-up', () => {
  it('day 0 gives 20% of the cap', async () => {
    await setConfig({
      accountPreset: 'recruiter',
      dailyInviteCap: 100,
      warmup: { enabled: true, startedAt: Date.now(), days: 14 },
    });
    expect(quota.warmupFactor(0)).toBeCloseTo(0.2, 5);
    expect(await quota.dailyCapFor('invite')).toBe(8); // 40 × 0.2
  });

  it('reaches full strength at day 14 and stays there', () => {
    expect(quota.warmupFactor(7)).toBeCloseTo(0.6, 5);
    expect(quota.warmupFactor(14)).toBe(1);
    expect(quota.warmupFactor(90)).toBe(1);
  });

  it('is inert when disabled', async () => {
    await setConfig({ accountPreset: 'free', warmup: { enabled: false } });
    expect(await quota.dailyCapFor('invite')).toBe(20);
  });
});

describe('check / record', () => {
  it('passes while under the cap and counts what is recorded', async () => {
    await setConfig({ accountPreset: 'free' });
    await expect(quota.check('invite')).resolves.toBeTruthy();
    await quota.record('invite');
    const snap = await quota.snapshot('invite');
    expect(snap.dailyUsed).toBe(1);
    expect(snap.hourlyUsed).toBe(1);
    expect(snap.dailyCap).toBe(20);
  });

  it('throws QUOTA_EXCEEDED at the daily ceiling and emits quota_hit', async () => {
    const sink = vi.fn();
    events.setSink(sink);
    await setConfig({ accountPreset: 'free', dailyInviteCap: 2, hourlyCap: 50 });
    await quota.record('invite');
    await quota.record('invite');
    const e = await caught(() => quota.check('invite'));
    expect(e.code).toBe(ERROR.QUOTA_EXCEEDED);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'quota_hit', payload: expect.objectContaining({ kind: 'invite' }) }),
    );
  });

  it('throws QUOTA_EXCEEDED at the hourly ceiling', async () => {
    await setConfig({ accountPreset: 'recruiter', hourlyCap: 2, dailyInviteCap: 100 });
    await quota.record('invite');
    await quota.record('invite');
    const e = await caught(() => quota.check('invite'));
    expect(e.code).toBe(ERROR.QUOTA_EXCEEDED);
    expect(e.message).toMatch(/hour/i);
  });

  it('counts search results, not search calls, against the 1000/day hard cap', async () => {
    await setConfig({ accountPreset: 'recruiter', dailySearchCap: 9999, hourlyCap: 50 });
    expect(await quota.dailyCapFor('search')).toBe(1000);

    await quota.record('search', 999);
    await expect(quota.check('search')).resolves.toBeTruthy();

    await quota.record('search', 1);
    const e = await caught(() => quota.check('search'));
    expect(e.code).toBe(ERROR.QUOTA_EXCEEDED);
    expect(e.message).toMatch(/search/i);
  });

  it('rolls the counters over at the day boundary', async () => {
    await setConfig({ accountPreset: 'free' });
    await quota.record('invite');
    expect((await quota.snapshot('invite')).dailyUsed).toBe(1);
    at(new Date(2026, 8, 10, 11, 0, 0));
    expect((await quota.snapshot('invite')).dailyUsed).toBe(0);
  });

  it('rolls the hourly counter over on the hour but keeps the daily one', async () => {
    await setConfig({ accountPreset: 'free' });
    await quota.record('invite');
    at(new Date(2026, 8, 9, 12, 0, 0));
    const snap = await quota.snapshot('invite');
    expect(snap.hourlyUsed).toBe(0);
    expect(snap.dailyUsed).toBe(1);
  });
});

describe('business hours', () => {
  it('blocks writes outside the window', async () => {
    await setConfig({ businessHoursOnly: true, businessStart: 9, businessEnd: 18 });
    at(WEDNESDAY_10PM);
    const e = await caught(() => quota.check('invite'));
    expect(e.code).toBe(ERROR.OUTSIDE_BUSINESS_HOURS);
  });

  it('blocks writes at the weekend when weekdaysOnly is on', async () => {
    await setConfig({ businessHoursOnly: true, weekdaysOnly: true });
    at(SATURDAY_11AM);
    const e = await caught(() => quota.check('invite'));
    expect(e.code).toBe(ERROR.OUTSIDE_BUSINESS_HOURS);
  });

  it('allows the weekend when weekdaysOnly is off', async () => {
    await setConfig({ businessHoursOnly: true, weekdaysOnly: false });
    at(SATURDAY_11AM);
    await expect(quota.check('invite')).resolves.toBeTruthy();
  });

  it('applies to every outreach bucket, not just campaigns', async () => {
    await setConfig({ businessHoursOnly: true });
    at(WEDNESDAY_10PM);
    for (const kind of ['invite', 'message', 'visit']) {
      const e = await caught(() => quota.check(kind));
      expect(e.code).toBe(ERROR.OUTSIDE_BUSINESS_HOURS);
    }
  });

  it('does not gate reads (the search bucket) on business hours', async () => {
    await setConfig({ businessHoursOnly: true });
    at(WEDNESDAY_10PM);
    await expect(quota.check('search')).resolves.toBeTruthy();
  });

  it('is off entirely when businessHoursOnly is false', async () => {
    await setConfig({ businessHoursOnly: false });
    at(WEDNESDAY_10PM);
    await expect(quota.check('invite')).resolves.toBeTruthy();
  });
});

describe('backoff and challenge', () => {
  it('429 pauses for 15 minutes with RATE_LIMITED and a retryAfter', async () => {
    await quota.noteBackoff(429);
    const e = await caught(() => quota.check('invite'));
    expect(e.code).toBe(ERROR.RATE_LIMITED);
    expect(e.extra.retryAfter).toBeGreaterThan(14 * 60 * 1000);
    expect(e.extra.retryAfter).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('999 pauses for an hour', async () => {
    await quota.noteBackoff(999);
    const e = await caught(() => quota.check('message'));
    expect(e.code).toBe(ERROR.RATE_LIMITED);
    expect(e.extra.retryAfter).toBeGreaterThan(59 * 60 * 1000);
  });

  it('451 blocks all writes until clearChallenge() and emits challenge_detected', async () => {
    const sink = vi.fn();
    events.setSink(sink);
    await quota.noteBackoff(451);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'challenge_detected' }),
    );

    for (const kind of ['invite', 'message', 'visit', 'search']) {
      const e = await caught(() => quota.check(kind));
      expect(e.code).toBe(ERROR.CHALLENGE_DETECTED);
    }

    // Time passing does not clear a challenge.
    at(new Date(2026, 8, 10, 11, 0, 0));
    expect((await caught(() => quota.check('invite'))).code).toBe(ERROR.CHALLENGE_DETECTED);

    await quota.clearChallenge();
    at(WEDNESDAY_11AM);
    await expect(quota.check('invite')).resolves.toBeTruthy();
  });

  it('an expired backoff stops blocking', async () => {
    await quota.noteBackoff(429);
    at(new Date(WEDNESDAY_11AM.getTime() + 16 * 60 * 1000));
    await expect(quota.check('invite')).resolves.toBeTruthy();
  });

  it('reports the pause in the status state', async () => {
    await quota.noteBackoff(429);
    const state = await quota.pauseState();
    expect(state.backoffUntil).toBeGreaterThan(Date.now());
    expect(state.challenge).toBeUndefined();
    await quota.noteBackoff(451);
    expect((await quota.pauseState()).challenge.detectedAt).toBeTruthy();
  });
});

describe('snapshot', () => {
  it('returns the contract RateLimit shape for every bucket', async () => {
    for (const kind of ['invite', 'message', 'visit', 'search']) {
      const snap = await quota.snapshot(kind);
      expect(Object.keys(snap).sort()).toEqual([
        'dailyCap',
        'dailyUsed',
        'hourlyCap',
        'hourlyUsed',
        'nextAllowedAt',
      ]);
    }
  });

  it('nextAllowedAt is 0 while sending is allowed and the backoff end while paused', async () => {
    expect((await quota.snapshot('invite')).nextAllowedAt).toBe(0);
    await quota.noteBackoff(429);
    expect((await quota.snapshot('invite')).nextAllowedAt).toBeGreaterThan(Date.now());
  });

  it('snapshotAll covers all four buckets', async () => {
    const all = await quota.snapshotAll();
    expect(Object.keys(all).sort()).toEqual(['invite', 'message', 'search', 'visit']);
  });
});

describe('humanDelay', () => {
  it('waits a random time between the configured bounds', async () => {
    const seen = [];
    quota.setSleepFn((ms) => {
      seen.push(ms);
      return Promise.resolve();
    });
    await setConfig({ minDelayMs: 5000, maxDelayMs: 6000 });
    await quota.humanDelay();
    await quota.humanDelay();
    for (const ms of seen) {
      expect(ms).toBeGreaterThanOrEqual(5000);
      expect(ms).toBeLessThanOrEqual(6000);
    }
    expect(seen).toHaveLength(2);
  });
});
