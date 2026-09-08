/**
 * Lists tab — create lists, inspect members with their signals, import and
 * export CSV, and enrol people into a campaign.
 *
 * The contract has no rename action, so a list keeps the name it was created
 * with; everything else here is contract-only.
 */

import { el, render, fmtDate, fmtNumber } from '../../ui/dom.js';
import { call } from '../../ui/api.js';
import { ACTIONS } from '../../lib/actions.js';
import {
  card,
  field,
  row,
  input,
  select,
  pill,
  errorLine,
  statusLine,
  busyButton,
  button,
  confirmDialog,
  empty,
} from '../../ui/components.js';
import { downloadText } from '../../ui/download.js';
import { readTextFile } from '../../ui/csv.js';

export const id = 'lists';
export const label = 'Lists';

const PAGE = 50;

const splitTags = (value) =>
  String(value || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

/** Signal badges plus the "we have spoken before" flag. */
function memberBadges(member) {
  const badges = (member.signals || []).map((s) => pill(s, 'info'));
  if (member.contactedBefore) badges.push(pill('contacted before', 'warn'));
  for (const tag of member.tags || []) badges.push(pill(tag));
  return badges.length ? el('div', { class: 'badges' }, badges) : null;
}

export async function mount(container) {
  const err = errorLine();
  const status = statusLine();
  const state = { lists: [], campaigns: [], selectedId: null, members: [], total: 0, start: 0 };

  async function loadLists() {
    const data = await call(ACTIONS.LIST_GET_ALL, {});
    state.lists = data.lists || [];
    if (state.selectedId && !state.lists.some((l) => l.listId === state.selectedId)) {
      state.selectedId = null;
    }
  }

  async function loadMembers(reset = true) {
    if (!state.selectedId) return;
    if (reset) {
      state.members = [];
      state.start = 0;
    }
    const data = await call(ACTIONS.LIST_MEMBERS, {
      listId: state.selectedId,
      start: state.start,
      count: PAGE,
    });
    state.members = reset ? data.members || [] : [...state.members, ...(data.members || [])];
    state.total = data.total ?? state.members.length;
  }

  async function selectList(listId) {
    state.selectedId = listId;
    try {
      await loadMembers(true);
    } catch (e) {
      err.show(e);
    }
    draw();
  }

  /* ---------------- create ---------------------------------------- */

  function createCard() {
    const name = input({ placeholder: 'Founders in Berlin' });
    const tags = input({ placeholder: 'tags, comma, separated' });
    return card(
      'New list',
      row(
        field('Name', name),
        field('Tags', tags),
        busyButton(
          'Create',
          async () => {
            if (!name.value.trim()) throw new Error('Name the list first.');
            const created = await call(ACTIONS.LIST_CREATE, {
              name: name.value.trim(),
              tags: splitTags(tags.value),
            });
            name.value = '';
            tags.value = '';
            await loadLists();
            await selectList(created.listId);
          },
          { variant: 'primary', error: err },
        ),
      ),
    );
  }

  /* ---------------- list of lists ---------------------------------- */

  function listsCard() {
    if (!state.lists.length) {
      return card('Lists', empty('No lists yet. Extract some people and save them into one.'));
    }
    return card(
      'Lists',
      el(
        'div',
        { class: 'itemlist scroll-y' },
        state.lists.map((list) =>
          el(
            'div',
            {
              class: `item${list.listId === state.selectedId ? ' is-selected' : ''}`,
              'data-list': list.listId,
              onclick: () => selectList(list.listId),
            },
            el(
              'div',
              { class: 'item-head' },
              el('span', { class: 'item-title' }, list.name),
              pill(`${fmtNumber(list.count)}`, 'info'),
            ),
            el('div', { class: 'item-sub' }, `Created ${fmtDate(list.createdAt)}`),
            (list.tags || []).length
              ? el(
                  'div',
                  { class: 'badges' },
                  list.tags.map((t) => pill(t)),
                )
              : null,
          ),
        ),
      ),
    );
  }

  /* ---------------- detail ------------------------------------------ */

  function selectedPublicIds(host) {
    const boxes = [...host.querySelectorAll('input[data-member]:checked')];
    return boxes.map((b) => b.dataset.member);
  }

  function detailCard() {
    const list = state.lists.find((l) => l.listId === state.selectedId);
    if (!list) return null;

    const detail = el('div');
    const csvInput = el('input', { type: 'file', accept: '.csv,text/csv', class: 'input' });
    const campaignSelect = select([
      { value: '', label: state.campaigns.length ? 'Choose a campaign…' : 'No campaigns yet' },
      ...state.campaigns.map((c) => ({ value: c.campaignId, label: `${c.name} (${c.status})` })),
    ]);

    const table = state.members.length
      ? el(
          'div',
          { class: 'scroll-y' },
          el(
            'table',
            null,
            el(
              'thead',
              null,
              el(
                'tr',
                null,
                el('th', null, ''),
                el('th', null, 'Name'),
                el('th', null, 'Role'),
                el('th', null, 'Added'),
                el('th', null, ''),
              ),
            ),
            el(
              'tbody',
              null,
              state.members.map((member) => {
                const profile = member.profile || {};
                return el(
                  'tr',
                  null,
                  el('td', null, el('input', { type: 'checkbox', 'data-member': member.publicId })),
                  el(
                    'td',
                    null,
                    el('div', null, profile.fullName || member.publicId),
                    memberBadges(member),
                  ),
                  el(
                    'td',
                    null,
                    [profile.title, profile.company].filter(Boolean).join(' · ') ||
                      profile.headline ||
                      '',
                  ),
                  el('td', null, fmtDate(member.addedAt)),
                  el(
                    'td',
                    null,
                    busyButton(
                      'Remove',
                      async () => {
                        await call(ACTIONS.LIST_REMOVE, {
                          listId: list.listId,
                          publicIds: [member.publicId],
                        });
                        await loadLists();
                        await loadMembers(true);
                        draw();
                      },
                      { variant: 'ghost', error: err },
                    ),
                  ),
                );
              }),
            ),
          ),
        )
      : empty('This list has no members yet.');

    render(
      detail,
      card(
        list.name,
        {
          hint: `${fmtNumber(state.total)} member${state.total === 1 ? '' : 's'} · lists cannot be renamed through the contract`,
          class: 'list-detail',
          actions: busyButton(
            'Delete list',
            async () => {
              const sure = await confirmDialog({
                title: `Delete "${list.name}"?`,
                message: 'The list and its membership go; the profiles themselves stay.',
                confirmLabel: 'Delete list',
                danger: true,
              });
              if (!sure) return;
              await call(ACTIONS.LIST_DELETE, { listId: list.listId });
              state.selectedId = null;
              await loadLists();
              draw();
            },
            { variant: 'danger', error: err },
          ),
        },
        table,
        state.members.length < state.total
          ? button(
              `Load more (${fmtNumber(state.total - state.members.length)} left)`,
              async () => {
                state.start = state.members.length;
                try {
                  await loadMembers(false);
                } catch (e) {
                  err.show(e);
                }
                draw();
              },
            )
          : null,
        el(
          'div',
          { class: 'row' },
          campaignSelect,
          busyButton(
            'Enrol',
            async () => {
              if (!campaignSelect.value) throw new Error('Choose a campaign first.');
              const chosen = selectedPublicIds(detail);
              const publicIds = chosen.length ? chosen : state.members.map((m) => m.publicId);
              if (!publicIds.length) throw new Error('Nobody to enrol.');
              const res = await call(ACTIONS.CAMPAIGN_ENROLL, {
                campaignId: campaignSelect.value,
                publicIds,
              });
              status.set(
                `Enrolled ${fmtNumber(res.enrolled)} (${fmtNumber(res.skipped)} skipped).`,
              );
            },
            { variant: 'primary', error: err },
          ),
        ),
        el(
          'div',
          { class: 'row' },
          field('Import CSV', csvInput),
          busyButton(
            'Import',
            async () => {
              const file = csvInput.files && csvInput.files[0];
              if (!file) throw new Error('Choose a CSV file first.');
              const csv = await readTextFile(file);
              const res = await call(ACTIONS.LIST_IMPORT_CSV, { listId: list.listId, csv });
              status.set(
                `Imported ${fmtNumber(res.added)} · ${fmtNumber(res.duplicates)} duplicates · ` +
                  `${fmtNumber(res.invalid)} invalid.`,
              );
              await loadLists();
              await loadMembers(true);
              draw();
            },
            { error: err },
          ),
          busyButton(
            'Export CSV',
            async () => {
              const data = await call(ACTIONS.EXPORT_CSV, { kind: 'list', id: list.listId });
              await downloadText(data.filename, data.csv, 'text/csv');
            },
            { error: err },
          ),
        ),
      ),
    );

    return detail;
  }

  /* ---------------- draw --------------------------------------------- */

  function draw() {
    render(container, [
      err,
      status,
      createCard(),
      listsCard(),
      state.selectedId ? detailCard() : null,
    ]);
  }

  try {
    await loadLists();
  } catch (e) {
    err.show(e);
  }
  try {
    const data = await call(ACTIONS.CAMPAIGN_GET_ALL, {});
    state.campaigns = data.campaigns || [];
  } catch {
    state.campaigns = [];
  }
  if (state.lists.length) {
    state.selectedId = state.lists[0].listId;
    try {
      await loadMembers(true);
    } catch (e) {
      err.show(e);
    }
  }
  draw();
}
