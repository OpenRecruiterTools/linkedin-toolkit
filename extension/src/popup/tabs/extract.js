/**
 * Extract tab — one card per extraction action in the contract.
 *
 * Every card runs an action, shows progress, counts the rows, and offers
 * "save to list" and a CSV/JSON download built in the popup.
 *
 * One card at the bottom is not an extraction: mass unfollow, which the engine
 * will only run from the popup. See `unfollowCard`.
 */

import { el, render, fmtNumber } from '../../ui/dom.js';
import { call } from '../../ui/api.js';
import {
  ACTIONS,
  UNFOLLOW_LIMIT_DEFAULT,
  UNFOLLOW_LIMIT_MAX,
  UNFOLLOW_LIMIT_MIN,
} from '../../lib/actions.js';
import {
  card,
  field,
  row,
  input,
  textarea,
  select,
  checkbox,
  errorLine,
  statusLine,
  progressBar,
  busyButton,
  button,
  confirmDialog,
  empty,
} from '../../ui/components.js';
import { downloadCsv, downloadJson, slug, today } from '../../ui/download.js';

export const id = 'extract';
export const label = 'Extract';

const MAX_PER_CALL = 100;
const EXPORT_BATCH = 10;

/* ================================================================== */
/*  Card specifications — one per contract extraction action           */
/* ================================================================== */

const SOURCES = [
  { value: 'search', label: 'People search' },
  { value: 'salesnav', label: 'Sales Navigator' },
  { value: 'recruiter', label: 'Recruiter' },
];

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const CARDS = [
  {
    key: 'search',
    title: 'People search',
    hint: 'Up to 100 results per call; pages loops with the nextStart cursor.',
    action: ACTIONS.SEARCH_PEOPLE,
    paged: true,
    rowsFrom: (data) => data.profiles || [],
    fields: [
      { name: 'keywords', label: 'Keywords', placeholder: 'head of talent', required: true },
      { name: 'title', label: 'Title', placeholder: 'optional' },
      { name: 'company', label: 'Company', placeholder: 'optional' },
      { name: 'location', label: 'Location', placeholder: 'optional' },
      { name: 'source', label: 'Source', type: 'select', options: SOURCES, value: 'search' },
      { name: 'count', label: 'Per page', type: 'number', value: 25, min: 1, max: MAX_PER_CALL },
      { name: 'pages', label: 'Pages', type: 'number', value: 1, min: 1, max: 20 },
    ],
    params: (v) => ({
      keywords: v.keywords,
      ...(v.title ? { title: v.title } : {}),
      ...(v.company ? { company: v.company } : {}),
      ...(v.location ? { location: v.location } : {}),
      source: v.source,
      count: Math.min(num(v.count, 25), MAX_PER_CALL),
    }),
  },
  {
    key: 'profiles',
    title: 'Profile export',
    hint: 'One LinkedIn URL per line. Runs in batches of 10 so progress is real.',
    action: ACTIONS.PROFILE_EXPORT,
    custom: 'profileExport',
    fields: [
      {
        name: 'urls',
        label: 'Profile URLs',
        type: 'textarea',
        rows: 4,
        placeholder: 'https://www.linkedin.com/in/…',
        required: true,
      },
      { name: 'full', label: 'Full capture (page text + photo)', type: 'checkbox' },
    ],
  },
  {
    key: 'engagers',
    title: 'Post engagers',
    action: ACTIONS.POST_ENGAGERS,
    paged: true,
    rowsFrom: (data) => data.engagers || [],
    fields: [
      {
        name: 'postUrl',
        label: 'Post URL',
        placeholder: 'https://www.linkedin.com/posts/…',
        required: true,
      },
      {
        name: 'kind',
        label: 'Reactions',
        type: 'select',
        options: [
          { value: 'both', label: 'Likes and comments' },
          { value: 'likes', label: 'Likes' },
          { value: 'comments', label: 'Comments' },
        ],
        value: 'both',
      },
      { name: 'count', label: 'Per page', type: 'number', value: 50, min: 1, max: MAX_PER_CALL },
      { name: 'pages', label: 'Pages', type: 'number', value: 1, min: 1, max: 20 },
    ],
    params: (v) => ({
      postUrl: v.postUrl,
      kind: v.kind,
      count: Math.min(num(v.count, 50), MAX_PER_CALL),
    }),
  },
  {
    key: 'group',
    title: 'Group members',
    action: ACTIONS.GROUP_MEMBERS,
    paged: true,
    rowsFrom: (data) => data.profiles || [],
    fields: [
      {
        name: 'groupUrl',
        label: 'Group URL',
        placeholder: 'https://www.linkedin.com/groups/…',
        required: true,
      },
      { name: 'count', label: 'Per page', type: 'number', value: 50, min: 1, max: MAX_PER_CALL },
      { name: 'pages', label: 'Pages', type: 'number', value: 1, min: 1, max: 20 },
    ],
    params: (v) => ({ groupUrl: v.groupUrl, count: Math.min(num(v.count, 50), MAX_PER_CALL) }),
  },
  {
    key: 'event',
    title: 'Event attendees',
    action: ACTIONS.EVENT_ATTENDEES,
    paged: true,
    rowsFrom: (data) => data.profiles || [],
    fields: [
      {
        name: 'eventUrl',
        label: 'Event URL',
        placeholder: 'https://www.linkedin.com/events/…',
        required: true,
      },
      { name: 'count', label: 'Per page', type: 'number', value: 50, min: 1, max: MAX_PER_CALL },
      { name: 'pages', label: 'Pages', type: 'number', value: 1, min: 1, max: 20 },
    ],
    params: (v) => ({ eventUrl: v.eventUrl, count: Math.min(num(v.count, 50), MAX_PER_CALL) }),
  },
  {
    key: 'company',
    title: 'Company',
    hint: 'Fetches the company record, then its employees when you ask for them.',
    action: ACTIONS.COMPANY_GET,
    custom: 'company',
    fields: [
      {
        name: 'universalName',
        label: 'Company',
        placeholder: 'universal name or full URL',
        required: true,
      },
      {
        name: 'count',
        label: 'Employees per page',
        type: 'number',
        value: 50,
        min: 1,
        max: MAX_PER_CALL,
      },
      { name: 'pages', label: 'Pages', type: 'number', value: 1, min: 1, max: 20 },
    ],
  },
  {
    key: 'connections',
    title: 'My connections',
    action: ACTIONS.NETWORK_CONNECTIONS,
    paged: true,
    rowsFrom: (data) => data.profiles || [],
    fields: [
      { name: 'count', label: 'Per page', type: 'number', value: 100, min: 1, max: MAX_PER_CALL },
      { name: 'pages', label: 'Pages', type: 'number', value: 1, min: 1, max: 50 },
    ],
    params: (v) => ({ count: Math.min(num(v.count, 100), MAX_PER_CALL) }),
  },
  {
    key: 'followers',
    title: 'My followers',
    action: ACTIONS.NETWORK_FOLLOWERS,
    paged: true,
    rowsFrom: (data) => data.profiles || [],
    fields: [
      { name: 'count', label: 'Per page', type: 'number', value: 100, min: 1, max: MAX_PER_CALL },
      { name: 'pages', label: 'Pages', type: 'number', value: 1, min: 1, max: 50 },
    ],
    params: (v) => ({ count: Math.min(num(v.count, 100), MAX_PER_CALL) }),
  },
  {
    key: 'inbox',
    title: 'Inbox export',
    hint: 'Threads and messages. Not people, so there is nothing to save to a list.',
    action: ACTIONS.INBOX_EXPORT,
    savable: false,
    rowsFrom: (data) => data.threads || [],
    fields: [{ name: 'since', label: 'Since', type: 'date' }],
    params: (v) => (v.since ? { since: Date.parse(v.since) } : {}),
  },
];

/* ================================================================== */
/*  Card rendering                                                     */
/* ================================================================== */

function buildControls(spec) {
  const controls = {};
  const nodes = [];

  for (const f of spec.fields) {
    let control;
    if (f.type === 'textarea') {
      control = textarea({ placeholder: f.placeholder || '', rows: f.rows || 3 });
    } else if (f.type === 'select') {
      control = select(f.options, { value: f.value });
    } else if (f.type === 'checkbox') {
      const box = checkbox(f.label);
      controls[f.name] = box.input;
      nodes.push(box);
      continue;
    } else if (f.type === 'number') {
      control = input({
        type: 'number',
        value: f.value,
        min: f.min ?? 1,
        max: f.max ?? MAX_PER_CALL,
      });
    } else if (f.type === 'date') {
      control = input({ type: 'date' });
    } else {
      control = input({ placeholder: f.placeholder || '' });
    }
    controls[f.name] = control;
    nodes.push(field(f.label, control, f.hint));
  }

  const read = () => {
    const values = {};
    for (const [name, node] of Object.entries(controls)) {
      values[name] = node.type === 'checkbox' ? node.checked : node.value.trim();
    }
    return values;
  };

  const requireFields = (values) => {
    for (const f of spec.fields) {
      if (f.required && !values[f.name]) throw new Error(`${f.label} is required.`);
    }
  };

  return { controls, nodes, read, requireFields };
}

/** Loop an action that paginates with `start` / `nextStart`. */
async function runPaged(spec, values, ctx) {
  const pages = Math.max(1, Number(values.pages) || 1);
  const base = spec.params ? spec.params(values) : {};
  const rows = [];
  let start = 0;

  for (let page = 0; page < pages; page += 1) {
    ctx.status.set(`Page ${page + 1} of ${pages}…`);
    ctx.progress.set(page, pages);
    const data = await call(spec.action, start ? { ...base, start } : base);
    const batch = spec.rowsFrom ? spec.rowsFrom(data) : [];
    rows.push(...batch);
    ctx.status.set(`${fmtNumber(rows.length)} so far…`);
    if (!batch.length || data.nextStart === undefined || data.nextStart === null) break;
    start = data.nextStart;
  }
  ctx.progress.set(pages, pages);
  return rows;
}

/** Bulk profile export, batched so the progress bar means something. */
async function runProfileExport(values, ctx) {
  const urls = String(values.urls || '')
    .split(/[\n,\s]+/)
    .map((u) => u.trim())
    .filter(Boolean);
  if (!urls.length) throw new Error('Paste at least one profile URL.');

  const rows = [];
  const failed = [];
  for (let i = 0; i < urls.length; i += EXPORT_BATCH) {
    const batch = urls.slice(i, i + EXPORT_BATCH);
    ctx.progress.set(i, urls.length);
    ctx.status.set(
      `Exporting ${i + 1}–${Math.min(i + batch.length, urls.length)} of ${urls.length}…`,
    );
    const data = await call(ACTIONS.PROFILE_EXPORT, {
      urls: batch,
      ...(values.full ? { full: true } : {}),
    });
    rows.push(...(data.profiles || []));
    failed.push(...(data.failed || []));
  }
  ctx.progress.set(urls.length, urls.length);
  if (failed.length) ctx.status.set(`${rows.length} exported, ${failed.length} failed.`);
  return rows;
}

/** Company record plus, optionally, its employees. */
async function runCompany(values, ctx, wantEmployees) {
  const raw = values.universalName;
  const universalName = raw.includes('/') ? raw.replace(/\/+$/, '').split('/').pop() || raw : raw;

  ctx.status.set('Fetching company…');
  const company = await call(ACTIONS.COMPANY_GET, { universalName });
  if (!wantEmployees) return [company];

  const rows = [];
  const pages = Math.max(1, Number(values.pages) || 1);
  const count = Math.min(num(values.count, 50), MAX_PER_CALL);
  let start = 0;
  for (let page = 0; page < pages; page += 1) {
    ctx.progress.set(page, pages);
    ctx.status.set(`Employees, page ${page + 1} of ${pages}…`);
    const data = await call(
      ACTIONS.COMPANY_EMPLOYEES,
      start ? { universalName, count, start } : { universalName, count },
    );
    const batch = data.profiles || [];
    rows.push(...batch);
    if (!batch.length || data.nextStart === undefined || data.nextStart === null) break;
    start = data.nextStart;
  }
  ctx.progress.set(pages, pages);
  return rows;
}

/** The results footer: count, save-to-list and downloads. */
function resultPanel(spec, state, lists, err) {
  const listSelect = select(
    [
      { value: '', label: lists.length ? 'Choose a list…' : 'No lists yet' },
      ...lists.map((l) => ({ value: l.listId, label: `${l.name} (${l.count})` })),
      { value: '__new__', label: '+ New list…' },
    ],
    {},
  );
  const newName = input({ placeholder: 'New list name', hidden: true });
  listSelect.addEventListener('change', () => {
    newName.hidden = listSelect.value !== '__new__';
  });

  const saveBtn = busyButton(
    'Save to list',
    async () => {
      const profiles = state.rows.filter((r) => r && r.publicId);
      if (!profiles.length) throw new Error('Nothing with a LinkedIn profile to save.');
      let listId = listSelect.value;
      if (!listId) throw new Error('Choose a list first.');
      if (listId === '__new__') {
        const name = newName.value.trim();
        if (!name) throw new Error('Name the new list.');
        const created = await call(ACTIONS.LIST_CREATE, { name });
        listId = created.listId;
      }
      const res = await call(ACTIONS.LIST_ADD, { listId, profiles });
      state.status.set(`Saved ${fmtNumber(res.added)} (${fmtNumber(res.duplicates)} duplicates).`);
    },
    { variant: 'primary', error: err },
  );

  const filename = `${slug(spec.key)}-${today()}`;

  return el(
    'div',
    { class: 'itemlist', 'data-testid': `results-${spec.key}` },
    el(
      'p',
      { class: 'status' },
      `${fmtNumber(state.rows.length)} result${state.rows.length === 1 ? '' : 's'}`,
    ),
    spec.savable === false ? null : el('div', { class: 'row' }, listSelect, newName, saveBtn),
    el(
      'div',
      { class: 'row' },
      button('Download CSV', async () => {
        try {
          await downloadCsv(`${filename}.csv`, state.rows);
        } catch (e) {
          err.show(e);
        }
      }),
      button('Download JSON', async () => {
        try {
          await downloadJson(`${filename}.json`, state.rows);
        } catch (e) {
          err.show(e);
        }
      }),
    ),
  );
}

function extractionCard(spec, shared) {
  const err = errorLine();
  const status = statusLine();
  const progress = progressBar();
  const results = el('div');
  const form = buildControls(spec);
  const state = { rows: [], status };

  const finish = (rows) => {
    state.rows = rows;
    status.set(`Done — ${fmtNumber(rows.length)} row${rows.length === 1 ? '' : 's'}.`);
    render(
      results,
      rows.length ? resultPanel(spec, state, shared.lists, err) : empty('No results.'),
    );
  };

  const runners = [];
  const ctx = { status, progress };

  if (spec.custom === 'profileExport') {
    runners.push(
      busyButton(
        'Export profiles',
        async () => {
          form.requireFields(form.read());
          finish(await runProfileExport(form.read(), ctx));
        },
        { variant: 'primary', error: err },
      ),
    );
  } else if (spec.custom === 'company') {
    runners.push(
      busyButton(
        'Get company',
        async () => {
          form.requireFields(form.read());
          finish(await runCompany(form.read(), ctx, false));
        },
        { variant: 'primary', error: err },
      ),
      busyButton(
        'Get employees',
        async () => {
          form.requireFields(form.read());
          finish(await runCompany(form.read(), ctx, true));
        },
        { variant: 'ghost', error: err },
      ),
    );
  } else if (spec.paged) {
    runners.push(
      busyButton(
        'Run',
        async () => {
          form.requireFields(form.read());
          finish(await runPaged(spec, form.read(), ctx));
        },
        { variant: 'primary', error: err },
      ),
    );
  } else {
    runners.push(
      busyButton(
        'Run',
        async () => {
          const values = form.read();
          form.requireFields(values);
          const data = await call(spec.action, spec.params ? spec.params(values) : {});
          finish(spec.rowsFrom ? spec.rowsFrom(data) : []);
        },
        { variant: 'primary', error: err },
      ),
    );
  }

  return card(
    spec.title,
    { hint: spec.hint, class: `extract-${spec.key}` },
    ...form.nodes,
    row(...runners),
    progress,
    status,
    err,
    results,
  );
}

/* ================================================================== */
/*  Mass unfollow                                                      */
/* ================================================================== */

/**
 * Mass unfollow is not an extraction — it returns counts and names, not rows —
 * so it is not in `CARDS`. It lives here because it is the only other thing
 * you do to your own network, and because the engine will only run it from the
 * popup: it drives the tab you are looking at.
 *
 * The card is built around not being surprised. "Unfollow up to" is filled in
 * with 25 so the first run is small — set it to 1 and watch what happens to
 * one person before you trust it with 800. "Preview" runs the identical walk
 * with `dryRun`, clicking nothing, and lists the names. Only then does the
 * red button, which says out loud how many it is about to unfollow.
 */
export const UNFOLLOW_WARNING =
  'Runs in your active LinkedIn tab, clicking Unfollow one person at a time with 2–5 second ' +
  'gaps. There is no undo.';

const accounts = (n) => `${fmtNumber(n)} account${n === 1 ? '' : 's'}`;

/** A plain list of names with a heading, or an empty state. */
function nameList(names, heading) {
  if (!names.length) return empty('Nobody to unfollow.');
  return el(
    'div',
    { class: 'itemlist', 'data-testid': 'unfollow-names' },
    el('p', { class: 'status' }, heading),
    el(
      'ul',
      { class: 'namelist' },
      names.map((name) => el('li', null, name)),
    ),
  );
}

export function unfollowCard() {
  const err = errorLine();
  const status = statusLine();
  const results = el('div');

  const limitInput = input({
    type: 'number',
    min: UNFOLLOW_LIMIT_MIN,
    max: UNFOLLOW_LIMIT_MAX,
    step: 1,
    value: String(UNFOLLOW_LIMIT_DEFAULT),
    placeholder: 'All',
    class: 'input input--num',
    'data-testid': 'unfollow-limit',
    'aria-label': 'Unfollow up to how many accounts',
  });

  /** `null` means "no limit" — the box was left empty on purpose. */
  const readLimit = () => {
    const raw = String(limitInput.value == null ? '' : limitInput.value).trim();
    if (!raw) return null;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < UNFOLLOW_LIMIT_MIN) {
      throw new Error(
        `Enter ${UNFOLLOW_LIMIT_MIN} or more, or clear the box to work through everyone.`,
      );
    }
    if (n > UNFOLLOW_LIMIT_MAX) {
      throw new Error(`One run does at most ${fmtNumber(UNFOLLOW_LIMIT_MAX)}.`);
    }
    return n;
  };

  const paramsFor = (extra) => {
    const limit = readLimit();
    return limit === null ? { ...extra } : { limit, ...extra };
  };

  const countBtn = busyButton(
    'Check count',
    async () => {
      const data = await call(ACTIONS.NETWORK_UNFOLLOW_COUNT, {});
      const count = Number(data.count) || 0;
      const sample = Array.isArray(data.sample) ? data.sample : [];
      status.set(`${accounts(count)} you can unfollow.`);
      render(results, sample.length ? nameList(sample, 'First few:') : null);
    },
    {
      variant: 'ghost',
      error: err,
      ariaLabel: 'Check how many accounts you follow',
    },
  );

  const previewBtn = busyButton(
    'Preview',
    async () => {
      const params = paramsFor({ dryRun: true });
      status.set('Reading your following list — nothing is being unfollowed…');
      const data = await call(ACTIONS.NETWORK_UNFOLLOW_ALL, params);
      const names = Array.isArray(data.names) ? data.names : [];
      status.set(
        names.length
          ? `Preview only — nothing was unfollowed. ${accounts(names.length)} would be:`
          : 'Preview only — found nobody to unfollow.',
      );
      render(results, nameList(names, 'Would unfollow:'));
    },
    {
      variant: 'ghost',
      error: err,
      ariaLabel: 'Preview who would be unfollowed, without unfollowing anyone',
    },
  );

  const unfollowBtn = busyButton(
    'Unfollow all',
    async () => {
      const params = paramsFor({});
      const limit = params.limit === undefined ? null : params.limit;
      const target = limit === null ? 'everyone you follow' : accounts(limit);

      const sure = await confirmDialog({
        title: limit === null ? 'Unfollow everyone?' : `Unfollow up to ${fmtNumber(limit)}?`,
        message: `This will unfollow ${target}. ${UNFOLLOW_WARNING}`,
        confirmLabel: limit === null ? 'Unfollow all' : `Unfollow ${fmtNumber(limit)}`,
        danger: true,
      });
      if (!sure) {
        status.set('Cancelled — nothing was unfollowed.');
        return;
      }

      status.set(`Unfollowing ${target} in your LinkedIn tab…`);
      try {
        const data = await call(ACTIONS.NETWORK_UNFOLLOW_ALL, params);
        const count = Number(data.unfollowed) || 0;
        const names = Array.isArray(data.names) ? data.names : [];
        const tail =
          data.stopped === 'limit'
            ? ' Stopped at your limit.'
            : data.error
              ? ` Stopped early: ${data.error}`
              : '';
        status.set(`Unfollowed ${accounts(count)}.${tail}`);
        render(results, nameList(names, 'Unfollowed:'));
      } catch (e) {
        status.clear();
        throw e;
      }
    },
    {
      variant: 'danger',
      error: err,
      ariaLabel: 'Unfollow everyone you follow',
    },
  );

  return card(
    'Mass unfollow',
    { hint: UNFOLLOW_WARNING, class: 'extract-unfollow' },
    field('Unfollow up to', limitInput, 'Leave empty to work through everyone.'),
    row(countBtn, previewBtn, unfollowBtn),
    status,
    err,
    results,
  );
}

/* ================================================================== */
/*  Tab                                                                */
/* ================================================================== */

export async function mount(container) {
  const shared = { lists: [] };
  try {
    const data = await call(ACTIONS.LIST_GET_ALL, {});
    shared.lists = data.lists || [];
  } catch {
    shared.lists = [];
  }

  render(container, [
    ...CARDS.map((spec) => extractionCard(spec, shared)),
    unfollowCard(),
  ]);
}
