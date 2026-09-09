/**
 * LinkedIn Toolkit — the approval queue (Copilot mode).
 *
 * Agent-originated writes land here instead of going to LinkedIn, and wait for
 * a human. Approving one runs it through the outreach send path with origin
 * `approved`, which bypasses the queue but *not* the quotas.
 *
 * Approving and sending are two separate things. `approve()` marks items and
 * returns; `sendApproved()` — kicked immediately and then run by the queue
 * alarm every minute — sends them one at a time at human pace. They were one
 * call until 2026-09-09, and the result was that approving three invitations
 * held the bridge open for well over a minute while the pacing delays ran, so
 * `lit queue approve` timed out and answered nothing while the sends carried
 * on behind it (issue #21).
 *
 * The executor is installed by outreach.js (`setExecutor`) rather than
 * imported, so the two modules do not form an import cycle.
 */

import { ACTIONS, ERROR, EVENTS, EngineError, validateParams } from '../lib/actions.js';
import { getConfig } from '../lib/config.js';
import { K, get, newId, set, stamp, update, withKeyLock } from '../lib/storage.js';
import { emit } from './events.js';
import { register } from './engine.js';

/** Only these four actions ever queue; view/follow/like are low-risk. */
export const QUEUEABLE = Object.freeze([
  ACTIONS.OUTREACH_INVITE,
  ACTIONS.OUTREACH_MESSAGE,
  ACTIONS.OUTREACH_INMAIL,
  ACTIONS.OUTREACH_COMMENT,
]);

/** Installed by outreach.js: `(action, params, context) => Promise<WriteResult>`. */
let executor = null;

export function setExecutor(fn) {
  executor = typeof fn === 'function' ? fn : null;
}

export function isQueueable(action) {
  return QUEUEABLE.includes(action);
}

async function readQueue() {
  return get(K.QUEUE, []);
}

/**
 * Park a write for human approval.
 *
 * `context` is whatever the originator needs to see on the other side of the
 * approval — for a campaign step, its campaignId and stepIndex, without which
 * the action log entry written on approval could not be attributed and the
 * campaign's stats would read zero.
 *
 * @returns {Promise<object>} the QueueItem
 */
export async function enqueue(action, params, origin, profile, context) {
  const item = stamp({
    id: newId('q'),
    action,
    params,
    origin,
    profile: profile || undefined,
    context: context && Object.keys(context).length ? context : undefined,
    createdAt: Date.now(),
    status: 'pending',
  });
  await update(K.QUEUE, (items) => [...items, item], []);
  await emit(EVENTS.QUEUE_ITEM_ADDED, { id: item.id, action, origin, publicId: params.publicId });
  return item;
}

/** Queue items, optionally filtered by status. */
export async function list(status) {
  const items = await readQueue();
  return status ? items.filter((i) => i.status === status) : items;
}

export async function pendingCount() {
  return (await list('pending')).length;
}

/** The params an item would be sent with, once `edits` are applied. */
function editedParams(item, edit = {}) {
  const params = { ...item.params };
  if (edit.note !== undefined) params.note = edit.note;
  if (edit.body !== undefined) params.body = edit.body;
  if (edit.subject !== undefined) params.subject = edit.subject;
  return params;
}

/**
 * Refuse an approval whose params the contract would not accept.
 *
 * Editing is the moment a human can make a queued write invalid — pasting a
 * 300-character note over a 190-character one, say — and the honest place to
 * say so is here, while they are looking at it, rather than at send time an
 * unknown number of seconds later with the item marked `failed`.
 */
function assertValid(action, params) {
  const check = validateParams(action, params);
  if (check.ok) return;
  throw new EngineError(
    ERROR.INVALID_PARAMS,
    check.message,
    check.howToFix ? { howToFix: check.howToFix } : {},
  );
}

/**
 * Approve items. Does **not** send them.
 *
 * `edits` is keyed by queue id and may carry `note`, `body` and/or `subject`,
 * which are merged into the item's params. Every edited item is validated
 * before anything is claimed, so one bad note refuses the whole call and
 * leaves the queue exactly as it was.
 *
 * Sending happens in `sendApproved()`, kicked on the next turn of the event
 * loop and again on every queue alarm. This returns as soon as the items are
 * marked, so a caller over the bridge is never left waiting through the
 * pacing delays; watch `queue_item_sent` or poll `queue.list` for the outcome.
 *
 * @returns {Promise<{approved: number}>} how many were marked approved
 */
export async function approve(ids, edits = {}) {
  // Validate before claiming: a refusal must change nothing.
  const items = await readQueue();
  for (const id of ids) {
    const item = items.find((i) => i.id === id);
    if (!item || item.status === 'sent' || item.status === 'approved') continue;
    assertValid(item.action, editedParams(item, (edits && edits[id]) || {}));
  }

  // Claim under the lock, so two approvals of the same id cannot both send.
  const claimed = await withKeyLock(K.QUEUE, async () => {
    const current = await readQueue();
    const taken = [];
    for (const id of ids) {
      const item = current.find((i) => i.id === id);
      if (!item || item.status === 'sent' || item.status === 'approved') continue;
      item.params = editedParams(item, (edits && edits[id]) || {});
      item.status = 'approved';
      item.updatedAt = Date.now();
      taken.push(item.id);
    }
    await set(K.QUEUE, current);
    return taken;
  });

  if (claimed.length) kickSender();
  return { approved: claimed.length };
}

/* ================================================================== */
/*  The sender                                                        */
/* ================================================================== */

/** One drain at a time; a second caller joins the one already running. */
let draining = null;

/** Errors that would fail every remaining item for exactly the same reason. */
const STOP_THE_DRAIN = new Set([
  ERROR.QUOTA_EXCEEDED,
  ERROR.OUTSIDE_BUSINESS_HOURS,
  ERROR.RATE_LIMITED,
  ERROR.CHALLENGE_DETECTED,
  ERROR.NOT_LOGGED_IN,
]);

/**
 * Send one approved item.
 * @returns {Promise<boolean>} whether it sent
 */
async function sendOne(item) {
  let patch;
  let sent = null;
  try {
    if (!executor) throw new Error('No outreach executor is installed.');
    const result = await executor(item.action, item.params, item.context || {});
    patch = { status: 'sent', result };
    sent = result;
  } catch (e) {
    patch = {
      status: 'failed',
      result: { error: { code: e.code || 'INTERNAL', message: e.message } },
    };
  }

  await update(
    K.QUEUE,
    (items) => items.map((i) => (i.id === item.id ? { ...i, ...patch, updatedAt: Date.now() } : i)),
    [],
  );

  if (sent) {
    await emit(EVENTS.QUEUE_ITEM_SENT, {
      id: item.id,
      action: item.action,
      publicId: item.params.publicId,
      result: sent,
      ...(item.context || {}),
    });
  }
  return !!sent;
}

/**
 * Send every approved item, one at a time.
 *
 * One at a time is the point: the send path paces itself, and two in flight at
 * once would defeat both the pacing and the quota reservation it protects. One
 * failure does not stop the rest — that item is marked `failed` and carries its
 * error — but a stand-down (a rate limit, a challenge, an exhausted quota)
 * would fail every remaining item for the same reason, so the drain stops and
 * leaves them approved for the next tick.
 *
 * @returns {Promise<{sent: number, failed: number, remaining: number}>}
 */
export async function sendApproved() {
  if (draining) return draining;
  draining = (async () => {
    let sent = 0;
    let failed = 0;

    // Re-read each time: the list changes as items are marked, and a human may
    // approve more while this is running.
    for (;;) {
      const next = (await readQueue()).find((i) => i.status === 'approved');
      if (!next) break;
      if (await sendOne(next)) sent += 1;
      else {
        failed += 1;
        const item = await byId(next.id);
        const code = item && item.result && item.result.error && item.result.error.code;
        if (STOP_THE_DRAIN.has(code)) break;
      }
    }

    const remaining = (await list('approved')).length;
    return { sent, failed, remaining };
  })().finally(() => {
    draining = null;
  });
  return draining;
}

/**
 * Start the drain on the next turn of the event loop.
 *
 * `setTimeout(0)` rather than a bare call, so `approve()` returns to its caller
 * first — that is the entire fix for issue #21 — and rather than waiting for
 * the alarm, so an approval a human is watching does not sit for up to a
 * minute before anything happens.
 */
export function kickSender() {
  setTimeout(() => {
    sendApproved().catch(() => {
      /* every failure is already recorded on the item itself */
    });
  }, 0);
}

export async function reject(ids) {
  let rejected = 0;
  await update(
    K.QUEUE,
    (items) =>
      items.map((item) => {
        if (!ids.includes(item.id) || item.status === 'sent') return item;
        rejected += 1;
        return { ...item, status: 'rejected', updatedAt: Date.now() };
      }),
    [],
  );
  return { rejected };
}

/** One queue item by id, or null. */
export async function byId(id) {
  return (await readQueue()).find((i) => i.id === id) || null;
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

/** What the caller is told when an agent tries to clear its own queue. */
export const APPROVAL_IS_HUMAN =
  'Approval is a human action. Approve in the popup, or turn on Autopilot in Settings.';

/**
 * The queue only means anything if the thing that filled it cannot also empty
 * it. `mcp` is an agent, so it is refused; `popup` is the human at the
 * extension and `cli` is the human at a terminal, so both pass. With Autopilot
 * on the human has already said "send without asking me", and the agent's own
 * writes never reach the queue in the first place, so the gate lifts.
 */
async function assertMayDecide(origin) {
  if (origin !== 'mcp') return;
  const config = await getConfig();
  if (config.autopilot) return;
  throw new EngineError(ERROR.UNAUTHORIZED, APPROVAL_IS_HUMAN);
}

register(ACTIONS.QUEUE_LIST, async ({ status }) => ({ items: await list(status) }));
register(ACTIONS.QUEUE_APPROVE, async ({ ids, edits }, ctx = {}) => {
  await assertMayDecide(ctx.origin);
  return approve(ids, edits);
});
register(ACTIONS.QUEUE_REJECT, async ({ ids }, ctx = {}) => {
  await assertMayDecide(ctx.origin);
  return reject(ids);
});
