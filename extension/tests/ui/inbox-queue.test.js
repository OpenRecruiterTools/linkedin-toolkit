/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import * as inbox from '../../src/popup/tabs/inbox.js';
import * as queue from '../../src/popup/tabs/queue.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { UI_KEYS } from '../../src/ui/api.js';
import {
  stubEngine,
  flush,
  mountPoint,
  threadFixture,
  queueItemFixture,
  profileFixture,
} from './helpers.js';

const clickIn = (host, text) => {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (!node) throw new Error(`no button "${text}"`);
  node.click();
  return node;
};

const setText = (node, value) => {
  node.value = value;
  node.dispatchEvent(new window.Event('input', { bubbles: true }));
};

/* ================================================================== */
/*  Inbox                                                              */
/* ================================================================== */

const messages = [
  { messageId: 'm1', threadId: 't1', fromPublicId: 'ada', body: 'Interested', sentAt: 1 },
  { messageId: 'm2', threadId: 't1', fromPublicId: 'me', body: 'Great', sentAt: 2 },
];

function inboxEngine(extra = {}) {
  return stubEngine({
    [ACTIONS.INBOX_THREADS]: {
      threads: [
        threadFixture(),
        threadFixture({ threadId: 't2', unread: false, sentiment: 'negative' }),
      ],
    },
    [ACTIONS.INBOX_MESSAGES]: { messages },
    ...extra,
  });
}

describe('Inbox tab', () => {
  it('lists threads with unread and sentiment markers', async () => {
    inboxEngine();
    const host = mountPoint();

    await inbox.mount(host);

    expect(host.querySelectorAll('[data-thread]')).toHaveLength(2);
    expect(host.querySelectorAll('.unread-dot')).toHaveLength(1);
    expect(host.textContent).toContain('positive');
    expect(host.textContent).toContain('negative');
    expect(host.textContent).toContain('2 conversations · 1 unread');
  });

  it('asks for unread only when the box is ticked', async () => {
    const engine = inboxEngine();
    const host = mountPoint();
    await inbox.mount(host);

    const box = [...host.querySelectorAll('input[type="checkbox"]')][0];
    box.checked = true;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flush(8);

    expect(engine.allParamsFor(ACTIONS.INBOX_THREADS).pop()).toEqual({
      count: 25,
      unreadOnly: true,
    });
  });

  it('opens a thread and shows its messages', async () => {
    const engine = inboxEngine();
    const host = mountPoint();
    await inbox.mount(host);

    clickIn(host, 'Open');
    await flush(8);

    expect(engine.paramsFor(ACTIONS.INBOX_MESSAGES)).toEqual({ threadId: 't1' });
    expect(host.querySelector('.thread')).toBeTruthy();
    expect(host.querySelectorAll('.msg')).toHaveLength(2);
  });

  it('sends a reply through outreach.message and reports queueing', async () => {
    const engine = inboxEngine({
      [ACTIONS.OUTREACH_MESSAGE]: { status: 'queued', queueId: 'q9' },
    });
    const host = mountPoint();
    await inbox.mount(host);
    clickIn(host, 'Open');
    await flush(8);

    setText(host.querySelector('.thread textarea'), 'Happy to talk Thursday.');
    clickIn(host.querySelector('.thread'), 'Send reply');
    await flush(8);

    expect(engine.paramsFor(ACTIONS.OUTREACH_MESSAGE)).toEqual({
      publicId: 'ada',
      body: 'Happy to talk Thursday.',
    });
    expect(host.textContent).toContain('Queued for your approval');
  });

  it('keeps saved replies in local storage, not in config', async () => {
    const engine = inboxEngine();
    const host = mountPoint();
    await inbox.mount(host);

    setText(
      [...host.querySelectorAll('input.input')].pop(),
      'Thanks — not right now, but keep me posted.',
    );
    clickIn(host, 'Add');
    await flush(8);

    const stored = await chrome.storage.local.get(UI_KEYS.SAVED_REPLIES);
    expect(stored[UI_KEYS.SAVED_REPLIES]).toEqual(['Thanks — not right now, but keep me posted.']);
    expect(engine.countOf(ACTIONS.CONFIG_SET)).toBe(0);
    expect(host.textContent).toContain('keep me posted');
  });

  it('snoozes a thread out of the list and back again', async () => {
    inboxEngine();
    const host = mountPoint();
    await inbox.mount(host);

    clickIn(host, 'Snooze 3d');
    await flush(8);
    expect(host.querySelectorAll('[data-thread]')).toHaveLength(1);

    const showSnoozed = [...host.querySelectorAll('input[type="checkbox"]')][1];
    showSnoozed.checked = true;
    showSnoozed.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flush(4);
    expect(host.querySelectorAll('[data-thread]')).toHaveLength(2);

    clickIn(host, 'Unsnooze');
    await flush(8);
    expect(host.textContent).toContain('Snooze 3d');
  });
});

/* ================================================================== */
/*  Queue                                                              */
/* ================================================================== */

function queueEngine(items, extra = {}) {
  return stubEngine({
    [ACTIONS.QUEUE_LIST]: (params) => ({
      items: items.filter((i) => i.status === (params.status || 'pending')),
    }),
    ...extra,
  });
}

describe('Queue tab', () => {
  it('renders pending items with their profile and preview', async () => {
    queueEngine([
      queueItemFixture(),
      queueItemFixture({
        id: 'q2',
        action: ACTIONS.OUTREACH_MESSAGE,
        params: { publicId: 'grace', body: 'Hello Grace' },
        profile: profileFixture('grace', { fullName: 'Grace Hopper' }),
      }),
    ]);
    const host = mountPoint();

    await queue.mount(host);

    expect(host.querySelectorAll('[data-queue]')).toHaveLength(2);
    expect(host.textContent).toContain('Ada Lovelace');
    expect(host.textContent).toContain('Invite');
    expect(host.textContent).toContain('campaign');
    expect(host.querySelector('[data-item="q1"]').value).toBe('Hi Ada');
    expect(host.querySelector('[data-item="q2"]').value).toBe('Hello Grace');
  });

  it('approves an item with the edited body', async () => {
    const engine = queueEngine([queueItemFixture()], {
      [ACTIONS.QUEUE_APPROVE]: { approved: 1 },
    });
    const host = mountPoint();
    await queue.mount(host);

    setText(host.querySelector('[data-item="q1"]'), 'Hi Ada — rewritten by hand.');
    clickIn(host.querySelector('[data-queue="q1"]'), 'Approve');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.QUEUE_APPROVE)).toEqual({
      ids: ['q1'],
      edits: { q1: { note: 'Hi Ada — rewritten by hand.' } },
    });
    expect(host.textContent).toContain('Approved 1');
  });

  it('sends no edits when nothing was touched', async () => {
    const engine = queueEngine([queueItemFixture()], {
      [ACTIONS.QUEUE_APPROVE]: { approved: 1 },
    });
    const host = mountPoint();
    await queue.mount(host);

    clickIn(host.querySelector('[data-queue="q1"]'), 'Approve');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.QUEUE_APPROVE)).toEqual({ ids: ['q1'] });
  });

  it('edits a message item into `body`, not `note`', async () => {
    const engine = queueEngine(
      [
        queueItemFixture({
          id: 'q2',
          action: ACTIONS.OUTREACH_MESSAGE,
          params: { publicId: 'grace', body: 'Hello' },
        }),
      ],
      { [ACTIONS.QUEUE_APPROVE]: { approved: 1 } },
    );
    const host = mountPoint();
    await queue.mount(host);

    setText(host.querySelector('[data-item="q2"]'), 'Hello again');
    clickIn(host.querySelector('[data-queue="q2"]'), 'Approve');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.QUEUE_APPROVE).edits).toEqual({
      q2: { body: 'Hello again' },
    });
    expect(queue.editableKey(ACTIONS.OUTREACH_INVITE)).toBe('note');
    expect(queue.editableKey(ACTIONS.OUTREACH_INMAIL)).toBe('body');
  });

  it('rejects an item', async () => {
    const engine = queueEngine([queueItemFixture()], { [ACTIONS.QUEUE_REJECT]: { rejected: 1 } });
    const host = mountPoint();
    await queue.mount(host);

    clickIn(host.querySelector('[data-queue="q1"]'), 'Reject');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.QUEUE_REJECT)).toEqual({ ids: ['q1'] });
  });

  it('approves everything pending at once, edits included', async () => {
    const engine = queueEngine([queueItemFixture(), queueItemFixture({ id: 'q2' })], {
      [ACTIONS.QUEUE_APPROVE]: { approved: 2 },
    });
    const host = mountPoint();
    await queue.mount(host);

    setText(host.querySelector('[data-item="q2"]'), 'Edited only this one');
    clickIn(host, 'Approve all (2)');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.QUEUE_APPROVE)).toEqual({
      ids: ['q1', 'q2'],
      edits: { q2: { note: 'Edited only this one' } },
    });
  });

  it('filters by status and locks non-pending items', async () => {
    const engine = queueEngine([
      queueItemFixture(),
      queueItemFixture({ id: 'q3', status: 'sent' }),
    ]);
    const host = mountPoint();
    await queue.mount(host);

    const filter = host.querySelector('select');
    filter.value = 'sent';
    filter.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flush(8);

    expect(engine.allParamsFor(ACTIONS.QUEUE_LIST).pop()).toEqual({ status: 'sent' });
    expect(host.querySelector('[data-item="q3"]').disabled).toBe(true);
    expect(
      [...host.querySelectorAll('button')].some((b) => b.textContent.includes('Approve')),
    ).toBe(false);
  });

  it('says so when the queue is empty', async () => {
    queueEngine([]);
    const host = mountPoint();

    await queue.mount(host);

    expect(host.textContent).toContain('Nothing pending');
  });
});
