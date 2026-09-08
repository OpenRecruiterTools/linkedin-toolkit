/**
 * Inbox tab — threads, one conversation at a time, and a reply box that goes
 * out through `outreach.message` so replies obey the same quotas and Copilot
 * approval as everything else.
 *
 * Saved replies and snoozes are local UI state in `chrome.storage.local`:
 * `config.set` clamps to the contract Config and would drop them.
 */

import { el, render, fmtAgo, fmtDate, fmtNumber } from '../../ui/dom.js';
import { call, getLocal, setLocal, UI_KEYS } from '../../ui/api.js';
import { ACTIONS } from '../../lib/actions.js';
import {
  card,
  row,
  input,
  textarea,
  select,
  checkbox,
  pill,
  errorLine,
  statusLine,
  busyButton,
  button,
  empty,
} from '../../ui/components.js';

export const id = 'inbox';
export const label = 'Inbox';

const THREAD_COUNT = 25;
const SNOOZE_MS = 3 * 86_400_000;

const sentimentTone = (sentiment) =>
  sentiment === 'positive' ? 'good' : sentiment === 'negative' ? 'bad' : 'neutral';

/** The person on the other end of a thread. */
function counterpart(thread) {
  const participants = thread.participants || [];
  return participants[0] || {};
}

export async function mount(container) {
  const err = errorLine();
  const summary = statusLine();
  const flash = statusLine();
  const state = {
    threads: [],
    openId: null,
    messages: [],
    unreadOnly: false,
    showSnoozed: false,
    savedReplies: [],
    snoozed: {},
  };

  async function loadThreads() {
    const data = await call(ACTIONS.INBOX_THREADS, {
      count: THREAD_COUNT,
      ...(state.unreadOnly ? { unreadOnly: true } : {}),
    });
    state.threads = data.threads || [];
  }

  async function openThread(threadId) {
    state.openId = threadId;
    const data = await call(ACTIONS.INBOX_MESSAGES, { threadId });
    state.messages = data.messages || [];
    draw();
  }

  const isSnoozed = (threadId) => (state.snoozed[threadId] || 0) > Date.now();

  async function snooze(threadId) {
    state.snoozed = { ...state.snoozed, [threadId]: Date.now() + SNOOZE_MS };
    await setLocal(UI_KEYS.SNOOZED, state.snoozed);
    if (state.openId === threadId) state.openId = null;
    draw();
  }

  async function unsnooze(threadId) {
    const next = { ...state.snoozed };
    delete next[threadId];
    state.snoozed = next;
    await setLocal(UI_KEYS.SNOOZED, next);
    draw();
  }

  /* ---------------- threads ----------------------------------------- */

  function threadsCard() {
    const unreadBox = checkbox('Unread only', { checked: state.unreadOnly });
    unreadBox.input.addEventListener('change', async () => {
      state.unreadOnly = unreadBox.input.checked;
      try {
        await loadThreads();
      } catch (e) {
        err.show(e);
      }
      draw();
    });

    const snoozedBox = checkbox('Show snoozed', { checked: state.showSnoozed });
    snoozedBox.input.addEventListener('change', () => {
      state.showSnoozed = snoozedBox.input.checked;
      draw();
    });

    const visible = state.threads.filter((t) => state.showSnoozed || !isSnoozed(t.threadId));

    return card(
      'Conversations',
      {
        actions: busyButton(
          'Refresh',
          async () => {
            await loadThreads();
            draw();
          },
          { variant: 'ghost', error: err },
        ),
      },
      row(unreadBox, snoozedBox),
      visible.length
        ? el(
            'div',
            { class: 'itemlist scroll-y' },
            visible.map((thread) => {
              const person = counterpart(thread);
              return el(
                'div',
                {
                  class: `item${thread.threadId === state.openId ? ' is-selected' : ''}`,
                  'data-thread': thread.threadId,
                },
                el(
                  'div',
                  { class: 'item-head' },
                  el(
                    'span',
                    { class: 'item-title' },
                    thread.unread ? el('span', { class: 'unread-dot' }) : null,
                    ` ${person.fullName || person.publicId || 'Unknown'}`,
                  ),
                  thread.sentiment ? pill(thread.sentiment, sentimentTone(thread.sentiment)) : null,
                ),
                el('div', { class: 'item-sub' }, thread.snippet || ''),
                el('div', { class: 'item-sub' }, fmtAgo(thread.lastMessageAt)),
                el(
                  'div',
                  { class: 'item-actions' },
                  busyButton('Open', () => openThread(thread.threadId), {
                    variant: 'ghost',
                    error: err,
                  }),
                  isSnoozed(thread.threadId)
                    ? button('Unsnooze', () => unsnooze(thread.threadId), { variant: 'ghost' })
                    : button('Snooze 3d', () => snooze(thread.threadId), { variant: 'ghost' }),
                ),
              );
            }),
          )
        : empty(state.threads.length ? 'Everything here is snoozed.' : 'No conversations.'),
    );
  }

  /* ---------------- one thread --------------------------------------- */

  function threadCard() {
    const thread = state.threads.find((t) => t.threadId === state.openId);
    if (!thread) return null;
    const person = counterpart(thread);

    const body = textarea({ placeholder: `Reply to ${person.fullName || 'them'}…`, rows: 3 });

    const savedSelect = select([
      { value: '', label: state.savedReplies.length ? 'Saved replies…' : 'No saved replies' },
      ...state.savedReplies.map((text, index) => ({
        value: String(index),
        label: text.slice(0, 40),
      })),
    ]);
    savedSelect.addEventListener('change', () => {
      const chosen = state.savedReplies[Number(savedSelect.value)];
      if (chosen) body.value = chosen;
    });

    return card(
      person.fullName || person.publicId || 'Conversation',
      {
        class: 'thread',
        actions: button('Close', () => {
          state.openId = null;
          draw();
        }),
      },
      state.messages.length
        ? el(
            'div',
            { class: 'itemlist scroll-y' },
            state.messages.map((message) =>
              el(
                'div',
                {
                  class: `msg${message.fromPublicId === person.publicId ? '' : ' msg--mine'}`,
                },
                el(
                  'div',
                  { class: 'msg-meta' },
                  `${message.fromPublicId === person.publicId ? person.fullName || 'Them' : 'You'} · ${fmtDate(
                    message.sentAt,
                    { time: true },
                  )}`,
                ),
                message.body,
              ),
            ),
          )
        : empty('No messages in this thread yet.'),
      body,
      row(
        savedSelect,
        busyButton(
          'Send reply',
          async () => {
            if (!body.value.trim()) throw new Error('Write something first.');
            if (!person.publicId)
              throw new Error('This thread has no LinkedIn profile to reply to.');
            const result = await call(ACTIONS.OUTREACH_MESSAGE, {
              publicId: person.publicId,
              body: body.value.trim(),
            });
            flash.set(
              result.status === 'queued'
                ? 'Queued for your approval — Copilot mode is on.'
                : 'Sent.',
            );
            body.value = '';
          },
          { variant: 'primary', error: err },
        ),
        button('Save as reply', async () => {
          if (!body.value.trim()) return;
          state.savedReplies = [...state.savedReplies, body.value.trim()];
          await setLocal(UI_KEYS.SAVED_REPLIES, state.savedReplies);
          draw();
        }),
      ),
    );
  }

  /* ---------------- saved replies ------------------------------------- */

  function savedRepliesCard() {
    const draft = input({ placeholder: 'A reply you send often' });
    return card(
      'Saved replies',
      { hint: 'Stored on this machine only.' },
      state.savedReplies.length
        ? el(
            'div',
            { class: 'itemlist' },
            state.savedReplies.map((text, index) =>
              el(
                'div',
                { class: 'item' },
                el('div', { class: 'item-sub' }, text),
                el(
                  'div',
                  { class: 'item-actions' },
                  button('Remove', async () => {
                    state.savedReplies = state.savedReplies.filter((_, i) => i !== index);
                    await setLocal(UI_KEYS.SAVED_REPLIES, state.savedReplies);
                    draw();
                  }),
                ),
              ),
            ),
          )
        : empty('None yet.'),
      row(
        draft,
        button('Add', async () => {
          if (!draft.value.trim()) return;
          state.savedReplies = [...state.savedReplies, draft.value.trim()];
          await setLocal(UI_KEYS.SAVED_REPLIES, state.savedReplies);
          draw();
        }),
      ),
    );
  }

  function draw() {
    const unread = state.threads.filter((t) => t.unread).length;
    summary.set(`${fmtNumber(state.threads.length)} conversations · ${fmtNumber(unread)} unread`);
    render(container, [err, summary, flash, threadsCard(), threadCard(), savedRepliesCard()]);
  }

  state.savedReplies = (await getLocal(UI_KEYS.SAVED_REPLIES, [])) || [];
  state.snoozed = (await getLocal(UI_KEYS.SNOOZED, {})) || {};
  try {
    await loadThreads();
  } catch (e) {
    err.show(e);
  }
  draw();
}
