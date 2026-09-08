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
import { K, get, newId, set, stamp } from '../lib/storage.js';
import { emit } from './events.js';
import { register } from './engine.js';

/** Only these four actions ever queue; view/follow/like are low-risk. */
export const QUEUEABLE = Object.freeze([
  ACTIONS.OUTREACH_INVITE,
  ACTIONS.OUTREACH_MESSAGE,
  ACTIONS.OUTREACH_INMAIL,
  ACTIONS.OUTREACH_COMMENT,
]);

/** Installed by outreach.js: `(action, params) => Promise<WriteResult>`. */
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

async function writeQueue(items) {
  await set(K.QUEUE, items);
  return items;
}

/**
 * Park a write for human approval.
 * @returns {Promise<object>} the QueueItem
 */
export async function enqueue(action, params, origin, profile) {
  const items = await readQueue();
  const item = stamp({
    id: newId('q'),
    action,
    params,
    origin,
    profile: profile || undefined,
    createdAt: Date.now(),
    status: 'pending',
  });
  items.push(item);
  await writeQueue(items);
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
  const items = await readQueue();
  let approved = 0;

  for (const id of ids) {
    const item = items.find((i) => i.id === id);
    if (!item || item.status === 'sent') continue;

    const edit = (edits && edits[id]) || {};
    const params = { ...item.params };
    if (edit.note !== undefined) params.note = edit.note;
    if (edit.body !== undefined) params.body = edit.body;
    if (edit.subject !== undefined) params.subject = edit.subject;
    item.params = params;
    item.status = 'approved';

    try {
      if (!executor) throw new Error('No outreach executor is installed.');
      const result = await executor(item.action, params);
      item.status = 'sent';
      item.result = result;
      approved += 1;
      await emit(EVENTS.QUEUE_ITEM_SENT, {
        id: item.id,
        action: item.action,
        publicId: params.publicId,
        result,
      });
    } catch (e) {
      item.status = 'failed';
      item.result = { error: { code: e.code || 'INTERNAL', message: e.message } };
    }
    item.updatedAt = Date.now();
  }

  await writeQueue(items);
  return { approved };
}

export async function reject(ids) {
  const items = await readQueue();
  let rejected = 0;
  for (const id of ids) {
    const item = items.find((i) => i.id === id);
    if (!item || item.status === 'sent') continue;
    item.status = 'rejected';
    item.updatedAt = Date.now();
    rejected += 1;
  }
  await writeQueue(items);
  return { rejected };
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

register(ACTIONS.QUEUE_LIST, async ({ status }) => ({ items: await list(status) }));
register(ACTIONS.QUEUE_APPROVE, ({ ids, edits }) => approve(ids, edits));
register(ACTIONS.QUEUE_REJECT, ({ ids }) => reject(ids));
