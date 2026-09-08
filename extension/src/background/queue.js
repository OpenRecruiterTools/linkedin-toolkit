/**
 * LinkedIn Toolkit — the approval queue (Copilot mode).
 *
 * Agent-originated writes land here instead of going to LinkedIn, and wait for
 * a human. Approving one runs it through the outreach send path with origin
 * `approved`, which bypasses the queue but *not* the quotas.
 *
 * The executor is installed by outreach.js (`setExecutor`) rather than
 * imported, so the two modules do not form an import cycle.
 */

import { ACTIONS, EVENTS } from '../lib/actions.js';
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

/**
 * Approve items and send them.
 *
 * `edits` is keyed by queue id and may carry `note` and/or `body`, which are
 * merged into the item's params before sending. One failure does not stop the
 * rest: that item is marked `failed` and carries its error.
 *
 * @returns {Promise<{approved: number}>} how many actually sent
 */
export async function approve(ids, edits = {}) {
  // Claim the items first, under the lock, so two approvals of the same id
  // cannot both send. Executing happens outside the lock — it makes network
  // calls and must not block every other queue write for its duration.
  const claimed = await withKeyLock(K.QUEUE, async () => {
    const items = await readQueue();
    const taken = [];
    for (const id of ids) {
      const item = items.find((i) => i.id === id);
      if (!item || item.status === 'sent' || item.status === 'approved') continue;
      const edit = (edits && edits[id]) || {};
      const params = { ...item.params };
      if (edit.note !== undefined) params.note = edit.note;
      if (edit.body !== undefined) params.body = edit.body;
      if (edit.subject !== undefined) params.subject = edit.subject;
      item.params = params;
      item.status = 'approved';
      item.updatedAt = Date.now();
      taken.push(item.id);
    }
    await set(K.QUEUE, items);
    return taken;
  });

  let approved = 0;

  for (const id of claimed) {
    const item = (await readQueue()).find((i) => i.id === id);
    if (!item) continue;

    let patch;
    let sent = null;
    try {
      if (!executor) throw new Error('No outreach executor is installed.');
      const result = await executor(item.action, item.params, item.context || {});
      patch = { status: 'sent', result };
      sent = result;
      approved += 1;
    } catch (e) {
      patch = { status: 'failed', result: { error: { code: e.code || 'INTERNAL', message: e.message } } };
    }

    await update(
      K.QUEUE,
      (items) =>
        items.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i)),
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
  }

  return { approved };
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

register(ACTIONS.QUEUE_LIST, async ({ status }) => ({ items: await list(status) }));
register(ACTIONS.QUEUE_APPROVE, ({ ids, edits }) => approve(ids, edits));
register(ACTIONS.QUEUE_REJECT, ({ ids }) => reject(ids));
