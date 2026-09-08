/**
 * LinkedIn Toolkit — inbox.
 *
 * Threads and messages are mirrored into local storage so `sync.pull`,
 * `export.csv` and campaign stop-on-reply can read them without another
 * LinkedIn call. `detectReplies()` is what turns a new inbound message into
 * the `reply_received` / `positive_reply` events an agent acts on.
 */

import { ACTIONS, EVENTS } from '../lib/actions.js';
import { K, get, set, since as sinceFilter } from '../lib/storage.js';
import { complete, isConfigured } from './ai.js';
import { emit } from './events.js';
import { register } from './engine.js';
import * as voyager from './voyager.js';

/** Keyword classification, used when no AI provider is configured. */
const NEGATIVE = /not interested|no thanks|no thank you|remove me|remove|unsubscribe|stop/i;
const POSITIVE = /interested|sure|yes|let's|lets |call|book|happy to|keen/i;

/**
 * `positive` | `negative` | `neutral` from the words alone.
 * Negative phrases are checked first: "not interested" contains "interested".
 */
export function classifyKeywords(body) {
  const text = String(body || '');
  if (NEGATIVE.test(text)) return 'negative';
  if (POSITIVE.test(text)) return 'positive';
  return 'neutral';
}

async function classify(body) {
  if (await isConfigured()) {
    try {
      const { output } = await complete('sentiment', { message: body });
      if (output && output.sentiment) {
        return { sentiment: output.sentiment, intent: output.intent || '' };
      }
    } catch {
      // A provider outage must not stop reply detection.
    }
  }
  return { sentiment: classifyKeywords(body), intent: '' };
}

/* ================================================================== */
/*  Storage                                                           */
/* ================================================================== */

export async function storedThreads() {
  return get(K.THREADS, []);
}

async function saveThreads(incoming) {
  const existing = await storedThreads();
  const byId = new Map(existing.map((t) => [t.threadId, t]));
  for (const thread of incoming) {
    const previous = byId.get(thread.threadId) || {};
    byId.set(thread.threadId, { ...previous, ...thread, updatedAt: thread.lastMessageAt || Date.now() });
  }
  const all = [...byId.values()];
  await set(K.THREADS, all);
  return all;
}

async function patchThread(threadId, patch) {
  const all = await storedThreads();
  const thread = all.find((t) => t.threadId === threadId);
  if (!thread) return null;
  Object.assign(thread, patch, { updatedAt: Date.now() });
  await set(K.THREADS, all);
  return thread;
}

export async function storedMessages(threadId) {
  return get(K.messages(threadId), []);
}

async function saveMessages(threadId, incoming) {
  const existing = await storedMessages(threadId);
  const byId = new Map(existing.map((m) => [m.messageId, m]));
  for (const message of incoming) {
    byId.set(message.messageId, { ...message, updatedAt: message.sentAt || Date.now() });
  }
  const all = [...byId.values()].sort((a, b) => a.sentAt - b.sentAt);
  await set(K.messages(threadId), all);
  return all;
}

/* ================================================================== */
/*  Reads                                                             */
/* ================================================================== */

/**
 * Refresh from LinkedIn, then filter.
 * @returns {Promise<{threads: Thread[]}>}
 */
export async function threads({ since = 0, unreadOnly = false, count = 20 } = {}) {
  const { threads: fetched } = await voyager.getConversations({ count });
  const stored = await saveThreads(fetched);

  let out = stored;
  if (since) out = out.filter((t) => (t.lastMessageAt || 0) > since);
  if (unreadOnly) out = out.filter((t) => t.unread);
  return { threads: out };
}

export async function messages(threadId, { since = 0, count = 20 } = {}) {
  const { messages: fetched } = await voyager.getConversationMessages({ threadId, count });
  const stored = await saveMessages(threadId, fetched);
  return { messages: since ? stored.filter((m) => m.sentAt > since) : stored };
}

/** Everything mirrored locally, changed since a timestamp. */
export async function exportAll({ since = 0 } = {}) {
  const allThreads = await storedThreads();
  const out = [];
  for (const thread of allThreads) {
    out.push(...(await storedMessages(thread.threadId)));
  }
  return {
    threads: sinceFilter(allThreads, since),
    messages: sinceFilter(out, since),
  };
}

/** True when `publicId` wrote to us after `timestamp`. Used by stopOnReply. */
export async function repliedSince(publicId, timestamp = 0) {
  for (const thread of await storedThreads()) {
    const messagesInThread = await storedMessages(thread.threadId);
    if (
      messagesInThread.some((m) => m.fromPublicId === publicId && (m.sentAt || 0) > timestamp)
    ) {
      return true;
    }
  }
  return false;
}

/* ================================================================== */
/*  Reply detection                                                   */
/* ================================================================== */

/**
 * Compare every thread against the last time we looked at it and raise an
 * event for each genuinely new inbound message.
 *
 * The very first run seeds the watermarks silently, so installing the
 * extension does not fire an event for every conversation you have ever had.
 *
 * @returns {Promise<{replies: object[], seeded: boolean}>}
 */
export async function detectReplies({ count = 20 } = {}) {
  const stored = await get(K.INBOX_SEEN, null);
  const seeding = stored === null;
  const seen = stored || {};

  const { threads: fetched } = await voyager.getConversations({ count });
  await saveThreads(fetched);

  const replies = [];

  for (const thread of fetched) {
    const watermark = seen[thread.threadId] || 0;
    const lastAt = thread.lastMessageAt || 0;

    if (seeding || lastAt <= watermark) {
      seen[thread.threadId] = Math.max(watermark, lastAt);
      continue;
    }

    const participants = new Set(thread.participants.map((p) => p.publicId).filter(Boolean));
    const { messages: fresh } = await messages(thread.threadId, { count });
    const inbound = fresh.filter((m) => participants.has(m.fromPublicId) && m.sentAt > watermark);
    const latest = inbound[inbound.length - 1];

    seen[thread.threadId] = Math.max(watermark, lastAt);
    if (!latest) continue;

    const { sentiment, intent } = await classify(latest.body);
    await patchThread(thread.threadId, { sentiment });

    const reply = {
      threadId: thread.threadId,
      publicId: latest.fromPublicId,
      body: latest.body,
      sentAt: latest.sentAt,
      sentiment,
      intent,
    };
    replies.push(reply);

    await emit(EVENTS.REPLY_RECEIVED, reply);
    if (sentiment === 'positive') await emit(EVENTS.POSITIVE_REPLY, reply);
  }

  await set(K.INBOX_SEEN, seen);
  return { replies, seeded: seeding };
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

register(ACTIONS.INBOX_THREADS, (params) => threads(params));
register(ACTIONS.INBOX_MESSAGES, ({ threadId, since }) => messages(threadId, { since }));
register(ACTIONS.INBOX_EXPORT, (params) => exportAll(params));
