/**
 * LinkedIn Toolkit — event emitter.
 *
 * `emit(name, payload)` fans one contract event out to:
 *   1. the bridge, when connected (installed with `setSink`, so this module
 *      never imports bridge.js and there is no import cycle);
 *   2. `chrome.notifications`, for the three events a human must see;
 *   3. the popup, via `chrome.runtime.sendMessage` (best-effort);
 *   4. a bounded on-disk log, so `sync.pull { since }` can replay events.
 */

import { EVENTS } from '../lib/actions.js';
import { K, get, set } from '../lib/storage.js';

const KNOWN = new Set(Object.values(EVENTS));

/** Events that raise a desktop notification. */
const NOTIFY = {
  [EVENTS.CHALLENGE_DETECTED]: {
    title: 'LinkedIn security challenge',
    message: 'Open LinkedIn and complete the challenge. All writes are paused until you do.',
  },
  [EVENTS.QUOTA_HIT]: {
    title: 'Daily limit reached',
    message: 'LinkedIn Toolkit has paused this action type until the quota resets.',
  },
  [EVENTS.POSITIVE_REPLY]: {
    title: 'Positive reply',
    message: 'Someone replied with interest — open the Inbox tab.',
  },
};

export const MAX_EVENT_LOG = 500;

/** Installed by bridge.js: `(frame) => void`. */
let sink = null;

export function setSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
}

export function hasSink() {
  return !!sink;
}

function notify(name, payload) {
  const spec = NOTIFY[name];
  if (!spec || !chrome.notifications) return;
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: spec.title,
      message: payload && payload.message ? String(payload.message) : spec.message,
    });
  } catch {
    /* notifications are advisory */
  }
}

async function record(frame) {
  const log = await get(K.EVENTS, []);
  log.push(frame);
  await set(K.EVENTS, log.length > MAX_EVENT_LOG ? log.slice(-MAX_EVENT_LOG) : log);
}

/**
 * Emit one contract event.
 * @param {string} name one of EVENTS
 * @param {object} payload
 * @returns {Promise<object>} the frame that was emitted
 */
export async function emit(name, payload = {}) {
  if (!KNOWN.has(name)) throw new Error(`unknown event: ${name}`);

  const frame = { event: name, payload };

  try {
    if (sink) await sink(frame);
  } catch {
    /* a disconnected bridge must never fail the action that emitted */
  }

  notify(name, payload);

  try {
    await chrome.runtime.sendMessage({ type: 'EVENT', event: name, payload });
  } catch {
    /* nobody listening (no popup open) */
  }

  await record({ ...frame, updatedAt: Date.now() });
  return frame;
}

/** Events recorded since a timestamp — the `events` array of `sync.pull`. */
export async function recent(from = 0) {
  const cutoff = Number(from) || 0;
  const log = await get(K.EVENTS, []);
  return log.filter((e) => (e.updatedAt || 0) > cutoff);
}
