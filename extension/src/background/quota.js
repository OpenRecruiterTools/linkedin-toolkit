/**
 * LinkedIn Toolkit — quotas, business hours, warm-up, backoff and pacing.
 *
 * Every write in the engine goes `check(kind)` → `humanDelay()` → the Voyager
 * call → `record(kind)`. Reads that consume a metered resource (search
 * results) do the same against the `search` bucket.
 *
 * Four buckets only, exactly as the contract says: invite, message, visit,
 * search. The effective daily cap is the *lowest* of the user's config, the
 * account preset and the hard cap, then scaled by the warm-up ramp.
 */

import { ERROR, EngineError, EVENTS, HARD_CAPS } from '../lib/actions.js';
import { getConfig } from '../lib/config.js';
import { K, get, set } from '../lib/storage.js';
import { emit } from './events.js';

/* ================================================================== */
/*  Constants                                                         */
/* ================================================================== */

export const KINDS = Object.freeze(['invite', 'message', 'visit', 'search']);

/** Buckets that represent an action LinkedIn attributes to a human. */
const WRITE_KINDS = new Set(['invite', 'message', 'visit']);

/** Per-day ceilings by account type. Always still under HARD_CAPS. */
export const PRESETS = Object.freeze({
  free: { invite: 20, message: 40, visit: 80, search: 300 },
  premium: { invite: 25, message: 60, visit: 120, search: 500 },
  salesnav: { invite: 30, message: 80, visit: 200, search: 800 },
  recruiter: { invite: 40, message: 100, visit: 300, search: 1000 },
});

const CONFIG_CAP_KEY = {
  invite: 'dailyInviteCap',
  message: 'dailyMessageCap',
  visit: 'dailyVisitCap',
  search: 'dailySearchCap',
};

const HARD_CAP_FOR = {
  invite: HARD_CAPS.dailyInviteCap,
  message: HARD_CAPS.dailyMessageCap,
  visit: HARD_CAPS.dailyVisitCap,
  search: HARD_CAPS.dailySearchCap,
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** HTTP status / LinkedIn code → how long to stand down. */
export const BACKOFF_MS = Object.freeze({
  429: 15 * MINUTE,
  999: HOUR,
});

const WARMUP_FLOOR = 0.2;

/* ================================================================== */
/*  Injectable sleep (tests replace it; production waits for real)     */
/* ================================================================== */

let sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setSleepFn(fn) {
  sleepFn = typeof fn === 'function' ? fn : (ms) => new Promise((r) => setTimeout(r, ms));
}

/* ================================================================== */
/*  Counter state                                                     */
/* ================================================================== */

function dayKey(now) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function emptyCounts() {
  return { invite: 0, message: 0, visit: 0, search: 0 };
}

/**
 * The stored counter state, rolled forward to the current day and hour.
 * Rolling is done on read so a service worker that was asleep at midnight
 * still reports the right numbers.
 */
async function readState(now = new Date()) {
  const stored = (await get(K.QUOTA, null)) || {};
  const day = dayKey(now);
  const hour = now.getHours();

  const state = {
    day,
    hour,
    daily: stored.day === day ? { ...emptyCounts(), ...(stored.daily || {}) } : emptyCounts(),
    hourly:
      stored.day === day && stored.hour === hour
        ? { ...emptyCounts(), ...(stored.hourly || {}) }
        : emptyCounts(),
    backoffUntil: stored.backoffUntil || 0,
    challenge: stored.challenge || null,
  };
  return state;
}

async function writeState(state) {
  await set(K.QUOTA, state);
  return state;
}

/* ================================================================== */
/*  Caps                                                              */
/* ================================================================== */

/**
 * Warm-up multiplier for a given day index: `min(1, 0.2 + 0.8 * day / 14)`.
 * Day 0 is 20% of the cap; day 14 onwards is the full cap.
 */
export function warmupFactor(dayIndex, days = 14) {
  const span = days > 0 ? days : 14;
  const idx = Math.max(0, Math.floor(dayIndex || 0));
  return Math.min(1, WARMUP_FLOOR + (1 - WARMUP_FLOOR) * (idx / span));
}

function warmupDayIndex(config, now = Date.now()) {
  const startedAt = config.warmup && config.warmup.startedAt;
  if (!startedAt) return 0;
  return Math.floor((now - startedAt) / (24 * HOUR));
}

/**
 * Effective hourly cap for a bucket.
 *
 * `config.hourlyCap` (ceiling 50) paces the actions LinkedIn attributes to a
 * human. Search is metered in *results*, not clicks, so a single 100-result
 * page would blow a 50/hour ceiling; the search bucket is therefore governed
 * by its daily cap alone and reports that as its hourly ceiling.
 */
export function hourlyCapFor(kind, config, dailyCap) {
  return WRITE_KINDS.has(kind) ? config.hourlyCap : dailyCap;
}

/** Effective daily cap for a bucket: min(config, preset, hard) × warm-up. */
export async function dailyCapFor(kind, config) {
  const cfg = config || (await getConfig());
  const preset = PRESETS[cfg.accountPreset] || PRESETS.free;
  const base = Math.min(cfg[CONFIG_CAP_KEY[kind]], preset[kind], HARD_CAP_FOR[kind]);
  if (!cfg.warmup || !cfg.warmup.enabled) return base;
  const factor = warmupFactor(warmupDayIndex(cfg), cfg.warmup.days);
  return Math.max(1, Math.floor(base * factor));
}

/* ================================================================== */
/*  Business hours                                                    */
/* ================================================================== */

/** True when `now` sits inside the configured working window. */
export function isWithinBusinessHours(config, now = new Date()) {
  const day = now.getDay(); // 0 = Sunday
  if (config.weekdaysOnly && (day === 0 || day === 6)) return false;
  const hour = now.getHours();
  return hour >= config.businessStart && hour < config.businessEnd;
}

/* ================================================================== */
/*  Backoff and challenges                                            */
/* ================================================================== */

/**
 * Record a LinkedIn stand-down signal.
 *  - 429 → 15 minutes
 *  - 999 → 1 hour
 *  - 451 → security challenge: every bucket is blocked until `clearChallenge()`
 * Anything else backs off for a minute.
 */
export async function noteBackoff(status) {
  const now = Date.now();
  const state = await readState(new Date(now));

  if (Number(status) === 451) {
    state.challenge = { detectedAt: now };
    await writeState(state);
    await emit(EVENTS.CHALLENGE_DETECTED, { detectedAt: now });
    return state;
  }

  const ms = BACKOFF_MS[Number(status)] || MINUTE;
  state.backoffUntil = Math.max(state.backoffUntil, now + ms);
  await writeState(state);
  return state;
}

/** Clear a security challenge once the human has dealt with it. */
export async function clearChallenge() {
  const state = await readState();
  state.challenge = null;
  state.backoffUntil = 0;
  return writeState(state);
}

/** `{ backoffUntil?, challenge? }` for `status.get`. */
export async function pauseState() {
  const state = await readState();
  const out = {};
  if (state.backoffUntil > Date.now()) out.backoffUntil = state.backoffUntil;
  if (state.challenge) out.challenge = state.challenge;
  return out;
}

/* ================================================================== */
/*  check / record / snapshot                                         */
/* ================================================================== */

function assertKind(kind) {
  if (!KINDS.includes(kind)) {
    throw new EngineError(ERROR.INTERNAL, `unknown quota bucket: ${kind}`);
  }
}

/**
 * Gate one unit of work.
 *
 * @param {'invite'|'message'|'visit'|'search'} kind
 * @param {number} [cost] units this call will consume (search counts results)
 * @throws {EngineError} CHALLENGE_DETECTED | RATE_LIMITED | OUTSIDE_BUSINESS_HOURS | QUOTA_EXCEEDED
 * @returns {Promise<object>} the RateLimit snapshot that permitted the call
 */
export async function check(kind, cost = 1) {
  assertKind(kind);
  const now = Date.now();
  const config = await getConfig();
  const state = await readState(new Date(now));

  if (state.challenge) {
    throw new EngineError(
      ERROR.CHALLENGE_DETECTED,
      'LinkedIn security challenge detected — open LinkedIn, complete it, then clear the challenge.',
      { howToFix: 'Complete the challenge on linkedin.com, then press "Clear challenge".' },
    );
  }

  if (state.backoffUntil > now) {
    throw new EngineError(ERROR.RATE_LIMITED, 'Paused after a LinkedIn rate-limit response.', {
      retryAfter: state.backoffUntil - now,
    });
  }

  if (config.businessHoursOnly && WRITE_KINDS.has(kind) && !isWithinBusinessHours(config)) {
    throw new EngineError(
      ERROR.OUTSIDE_BUSINESS_HOURS,
      `Outside the configured window (${config.businessStart}:00–${config.businessEnd}:00${
        config.weekdaysOnly ? ', weekdays only' : ''
      }).`,
      { howToFix: 'Wait for the window, or turn off businessHoursOnly in settings.' },
    );
  }

  const dailyCap = await dailyCapFor(kind, config);
  const hourlyCap = hourlyCapFor(kind, config, dailyCap);
  if (state.hourly[kind] + cost > hourlyCap) {
    throw new EngineError(
      ERROR.QUOTA_EXCEEDED,
      `Hourly cap reached for ${kind} (${hourlyCap}/hour).`,
      { retryAfter: nextHourAt(now) - now },
    );
  }

  if (state.daily[kind] + cost > dailyCap) {
    await emit(EVENTS.QUOTA_HIT, {
      kind,
      used: state.daily[kind],
      cap: dailyCap,
      resetsAt: nextDayAt(now),
    });
    throw new EngineError(
      ERROR.QUOTA_EXCEEDED,
      `Daily ${kind} cap reached (${dailyCap}/day).`,
      { retryAfter: nextDayAt(now) - now },
    );
  }

  return toRateLimit(state, kind, hourlyCap, dailyCap, now);
}

/** Count `n` units against a bucket (search records the number of results). */
export async function record(kind, n = 1) {
  assertKind(kind);
  const units = Math.max(0, Math.round(n));
  const state = await readState();
  state.daily[kind] += units;
  state.hourly[kind] += units;
  await writeState(state);
  return state.daily[kind];
}

function nextHourAt(now) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  return d.getTime() + HOUR;
}

function nextDayAt(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + 24 * HOUR;
}

function toRateLimit(state, kind, hourlyCap, dailyCap, now) {
  let nextAllowedAt = 0;
  if (state.challenge) nextAllowedAt = Number.MAX_SAFE_INTEGER;
  else if (state.backoffUntil > now) nextAllowedAt = state.backoffUntil;
  else if (state.hourly[kind] >= hourlyCap) nextAllowedAt = nextHourAt(now);
  else if (state.daily[kind] >= dailyCap) nextAllowedAt = nextDayAt(now);

  return {
    hourlyUsed: state.hourly[kind],
    hourlyCap,
    dailyUsed: state.daily[kind],
    dailyCap,
    nextAllowedAt,
  };
}

/** RateLimit for one bucket. Wired into the engine via `setRateLimitProvider`. */
export async function snapshot(kind) {
  assertKind(kind);
  const now = Date.now();
  const config = await getConfig();
  const state = await readState(new Date(now));
  const dailyCap = await dailyCapFor(kind, config);
  return toRateLimit(state, kind, hourlyCapFor(kind, config, dailyCap), dailyCap, now);
}

/** RateLimit for all four buckets — the `quotas` field of `Status`. */
export async function snapshotAll() {
  const out = {};
  for (const kind of KINDS) out[kind] = await snapshot(kind);
  return out;
}

/* ================================================================== */
/*  Pacing                                                            */
/* ================================================================== */

/** Sleep a random time between `minDelayMs` and `maxDelayMs`. */
export async function humanDelay() {
  const config = await getConfig();
  const spread = Math.max(0, config.maxDelayMs - config.minDelayMs);
  const ms = Math.round(config.minDelayMs + Math.random() * spread);
  await sleepFn(ms);
  return ms;
}
