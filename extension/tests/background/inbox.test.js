import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as events from '../../src/background/events.js';
import * as inbox from '../../src/background/inbox.js';
import { seedSession, stubFetch } from '../helpers/net.js';

import conversations from '../fixtures/voyager/conversations.json';
import conversationEvents from '../fixtures/voyager/conversationEvents.json';

let net;
let seen;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 9, 11, 0, 0));
  seedSession();
  net = stubFetch();
  seen = [];
  events.setSink((f) => seen.push(f));
});

afterEach(() => {
  events.setSink(null);
  vi.useRealTimers();
});

const names = () => seen.map((f) => f.event);

/** The conversation list with one newer inbound message on thread 2-abc123. */
function withNewReply(text, at = 1757900000000) {
  const clone = structuredClone(conversations);
  clone.elements[0].lastActivityAt = at;
  clone.elements[0].events[0].createdAt = at;
  clone.elements[0].events[0].eventContent[
    'com.linkedin.voyager.messaging.event.MessageEvent'
  ].attributedBody.text = text;
  return clone;
}

function eventsWith(text, at = 1757900000000) {
  const clone = structuredClone(conversationEvents);
  clone.elements[0].createdAt = at;
  clone.elements[0].eventContent[
    'com.linkedin.voyager.messaging.event.MessageEvent'
  ].attributedBody.text = text;
  return clone;
}

describe('inbox.threads', () => {
  it('returns contract Threads and stores them', async () => {
    net.push(conversations);
    const res = await handle(ACTIONS.INBOX_THREADS, {});
    expect(res.data.threads).toHaveLength(2);
    expect(res.data.threads[0]).toMatchObject({ threadId: '2-abc123', unread: true });

    net.push(conversations);
    expect((await handle(ACTIONS.INBOX_THREADS, {})).data.threads).toHaveLength(2);
  });

  it('filters on since and unreadOnly', async () => {
    net.push(conversations);
    expect((await handle(ACTIONS.INBOX_THREADS, { unreadOnly: true })).data.threads).toHaveLength(1);

    net.push(conversations);
    const recent = await handle(ACTIONS.INBOX_THREADS, { since: 1757000000000 });
    expect(recent.data.threads.map((t) => t.threadId)).toEqual(['2-abc123']);
  });
});

describe('inbox.messages', () => {
  it('returns messages oldest-first and stores them', async () => {
    net.push(conversationEvents);
    const res = await handle(ACTIONS.INBOX_MESSAGES, { threadId: '2-abc123' });
    expect(res.data.messages).toHaveLength(2);
    expect(res.data.messages[1].fromPublicId).toBe('adalovelace');

    net.push(conversationEvents);
    const since = await handle(ACTIONS.INBOX_MESSAGES, { threadId: '2-abc123', since: 1757150000000 });
    expect(since.data.messages).toHaveLength(1);
  });
});

describe('detectReplies', () => {
  it('seeds silently on the very first run', async () => {
    net.push(conversations);
    const res = await inbox.detectReplies();
    expect(res.replies).toHaveLength(0);
    expect(names()).not.toContain('reply_received');
  });

  it('emits reply_received for a message that arrived since the last look', async () => {
    net.push(conversations);
    await inbox.detectReplies();

    net.push(withNewReply('Yes, happy to talk.'));
    net.push(eventsWith('Yes, happy to talk.'));
    const res = await inbox.detectReplies();

    expect(res.replies).toHaveLength(1);
    expect(res.replies[0]).toMatchObject({ threadId: '2-abc123', publicId: 'adalovelace' });
    expect(names()).toContain('reply_received');
  });

  it('does not emit the same reply twice', async () => {
    net.push(conversations);
    await inbox.detectReplies();
    net.push(withNewReply('Yes, happy to talk.'));
    net.push(eventsWith('Yes, happy to talk.'));
    await inbox.detectReplies();

    seen.length = 0;
    net.push(withNewReply('Yes, happy to talk.'));
    const again = await inbox.detectReplies();
    expect(again.replies).toHaveLength(0);
    expect(names()).toHaveLength(0);
  });
});

describe('sentiment', () => {
  it.each([
    ['Yes, interested — can we book a call?', 'positive'],
    ["Sure, let's talk next week", 'positive'],
    ['Not interested, please remove me', 'negative'],
    ['No thanks', 'negative'],
    ['Please stop messaging me', 'negative'],
    ['I will forward this to my colleague', 'neutral'],
  ])('keyword fallback classifies %j as %s', (body, expected) => {
    expect(inbox.classifyKeywords(body)).toBe(expected);
  });

  it('checks the negative phrases before the positive ones', () => {
    expect(inbox.classifyKeywords('Not interested')).toBe('negative');
  });

  it('emits positive_reply and records the sentiment on the thread', async () => {
    net.push(conversations);
    await inbox.detectReplies();

    net.push(withNewReply('Yes, interested — can we book a call?'));
    net.push(eventsWith('Yes, interested — can we book a call?'));
    const res = await inbox.detectReplies();

    expect(res.replies[0].sentiment).toBe('positive');
    expect(names()).toContain('positive_reply');
    const stored = await inbox.storedThreads();
    expect(stored.find((t) => t.threadId === '2-abc123').sentiment).toBe('positive');
  });

  it('does not emit positive_reply for a negative reply', async () => {
    net.push(conversations);
    await inbox.detectReplies();

    net.push(withNewReply('Not interested, please remove me'));
    net.push(eventsWith('Not interested, please remove me'));
    const res = await inbox.detectReplies();

    expect(res.replies[0].sentiment).toBe('negative');
    expect(names()).not.toContain('positive_reply');
  });

  it('uses the AI classifier when one is configured', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: 'sk-test' } });
    net.push(conversations);
    await inbox.detectReplies();

    net.push(withNewReply('I will forward this to my colleague'));
    net.push(eventsWith('I will forward this to my colleague'));
    net.push({ content: [{ text: '{"sentiment":"positive","intent":"referral"}' }] });

    const res = await inbox.detectReplies();
    expect(res.replies[0].sentiment).toBe('positive');
    expect(res.replies[0].intent).toBe('referral');
    expect(net.calls.some((c) => c.url.includes('api.anthropic.com'))).toBe(true);
  });

  it('falls back to keywords when the AI call fails', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: 'sk-test' } });
    net.push(conversations);
    await inbox.detectReplies();

    net.push(withNewReply('Yes, interested'));
    net.push(eventsWith('Yes, interested'));
    net.push({ __status: 500, body: {} });

    const res = await inbox.detectReplies();
    expect(res.replies[0].sentiment).toBe('positive');
  });
});

describe('repliedSince', () => {
  it('is true only when they wrote after the timestamp', async () => {
    net.push(conversations);
    await inbox.detectReplies();
    net.push(withNewReply('Yes, happy to talk.'));
    net.push(eventsWith('Yes, happy to talk.'));
    await inbox.detectReplies();

    expect(await inbox.repliedSince('adalovelace', 1757800000000)).toBe(true);
    expect(await inbox.repliedSince('adalovelace', 1757950000000)).toBe(false);
    expect(await inbox.repliedSince('nobody', 0)).toBe(false);
  });
});

describe('inbox.export', () => {
  it('returns everything stored since a timestamp', async () => {
    net.push(conversations);
    await handle(ACTIONS.INBOX_THREADS, {});
    net.push(conversationEvents);
    await handle(ACTIONS.INBOX_MESSAGES, { threadId: '2-abc123' });

    const all = (await handle(ACTIONS.INBOX_EXPORT, {})).data;
    expect(all.threads).toHaveLength(2);
    expect(all.messages).toHaveLength(2);

    const some = (await handle(ACTIONS.INBOX_EXPORT, { since: 1757150000000 })).data;
    expect(some.threads).toHaveLength(1);
    expect(some.messages).toHaveLength(1);
  });
});
