/**
 * Research Pack tab — drop a CSV of names, get a dossier per row.
 *
 * The CSV is parsed in the popup, mapped onto the contract `ResearchRow`
 * shape, and handed to `research.pack`. Progress comes from polling
 * `research.get` every five seconds while the tab is open.
 */

import { el, render, fmtNumber, fmtDuration } from '../../ui/dom.js';
import { call } from '../../ui/api.js';
import { ACTIONS } from '../../lib/actions.js';
import {
  card,
  field,
  row,
  input,
  textarea,
  select,
  checkbox,
  pill,
  errorLine,
  statusLine,
  progressBar,
  busyButton,
  button,
  activatable,
  empty,
} from '../../ui/components.js';
import {
  parseCsv,
  readTextFile,
  guessMapping,
  toResearchRows,
  RESEARCH_FIELDS,
} from '../../ui/csv.js';
import { downloadCsv, downloadMarkdown, slug, today } from '../../ui/download.js';

export const id = 'research';
export const label = 'Research';

export const POLL_MS = 5000;
const PREVIEW_ROWS = 3;

const kindTone = (kind) => (kind === 'unresolved' ? 'bad' : kind === 'company' ? 'info' : 'good');

let pollTimer = null;

/** Stop polling when the tab (or the popup) goes away. */
export function unmount() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export async function mount(container) {
  const err = errorLine();
  const status = statusLine();
  const progress = progressBar();

  const state = {
    headers: [],
    parsed: [],
    mapping: {},
    rows: [],
    job: null,
    packs: [],
    startedAt: 0,
    done: 0,
    total: 0,
    jobStatus: 'idle',
  };

  unmount();

  /* ---------------- input ------------------------------------------- */

  function ingest(text) {
    const parsed = parseCsv(text);
    if (!parsed.headers.length) throw new Error('That does not look like a CSV with a header row.');
    state.headers = parsed.headers;
    state.parsed = parsed.rows;
    state.mapping = guessMapping(parsed.headers);
    state.rows = toResearchRows(state.parsed, state.mapping);
    status.set(`${fmtNumber(state.rows.length)} rows read.`);
    draw();
  }

  function remap() {
    state.rows = toResearchRows(state.parsed, state.mapping);
    draw();
  }

  function inputCard() {
    const fileInput = el('input', {
      type: 'file',
      accept: '.csv,text/csv',
      class: 'input',
      hidden: true,
      onchange: async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          ingest(await readTextFile(file));
        } catch (e) {
          err.show(e);
        }
      },
    });

    const drop = el(
      'div',
      {
        class: 'dropzone',
        'data-testid': 'dropzone',
        ondragover: (e) => {
          e.preventDefault();
          drop.classList.add('is-over');
        },
        ondragleave: () => drop.classList.remove('is-over'),
        ondrop: async (e) => {
          e.preventDefault();
          drop.classList.remove('is-over');
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (!file) return;
          try {
            ingest(await readTextFile(file));
          } catch (e2) {
            err.show(e2);
          }
        },
      },
      'Drop a CSV here, or click to choose one',
    );
    // A drop target cannot be a <button>, so it is given button semantics and
    // keyboard activation explicitly.
    activatable(drop, () => fileInput.click(), { label: 'Choose a CSV file' });

    const paste = textarea({
      rows: 3,
      'aria-label': 'Paste CSV rows',
      placeholder: '…or paste CSV: name,linkedin_url,email,domain,company',
    });

    return card(
      'Rows',
      { hint: 'Everything is parsed here in your browser. Nothing is uploaded.' },
      drop,
      fileInput,
      paste,
      button('Read pasted CSV', () => {
        try {
          ingest(paste.value);
        } catch (e) {
          err.show(e);
        }
      }),
    );
  }

  /* ---------------- mapping ------------------------------------------ */

  function mappingCard() {
    if (!state.headers.length) return null;
    const options = [
      { value: '', label: '— ignore —' },
      ...state.headers.map((h) => ({ value: h, label: h })),
    ];

    const selects = RESEARCH_FIELDS.map(({ key, label: fieldLabel }) => {
      const node = select(options, { value: state.mapping[key] || '', 'data-field': key });
      node.addEventListener('change', () => {
        state.mapping[key] = node.value || null;
        remap();
      });
      return field(fieldLabel, node);
    });

    const preview = state.rows.slice(0, PREVIEW_ROWS);
    const extraKeys = [...new Set(preview.flatMap((r) => Object.keys(r)))].filter(
      (k) => !RESEARCH_FIELDS.some((f) => f.key === k),
    );

    return card(
      'Columns',
      {
        class: 'mapping',
        hint: `${fmtNumber(state.rows.length)} rows · extra columns ride along untouched`,
      },
      el('div', { class: 'grid-2' }, selects),
      el(
        'div',
        { class: 'scroll-x' },
        el(
          'table',
          null,
          el(
            'thead',
            null,
            el(
              'tr',
              null,
              RESEARCH_FIELDS.map((f) => el('th', null, f.label)),
              extraKeys.map((k) => el('th', null, k)),
            ),
          ),
          el(
            'tbody',
            null,
            preview.map((r) =>
              el(
                'tr',
                null,
                RESEARCH_FIELDS.map((f) => el('td', null, r[f.key] || '')),
                extraKeys.map((k) => el('td', null, r[k] || '')),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /* ---------------- run ---------------------------------------------- */

  function optionsCard() {
    const full = checkbox('Full capture (page text and photo)');
    const enrich = checkbox('Enrich contact details');
    const listName = input({ placeholder: 'Save results into this list (optional)' });

    return card(
      'Run',
      { class: 'research-run' },
      full,
      enrich,
      field('List name', listName),
      busyButton(
        'Build research packs',
        async () => {
          if (!state.rows.length) throw new Error('Load some rows first.');
          const params = { rows: state.rows };
          if (listName.value.trim()) params.listName = listName.value.trim();
          if (enrich.input.checked) params.enrich = true;
          if (full.input.checked) params.full = true;

          const job = await call(ACTIONS.RESEARCH_PACK, params);
          state.job = job.jobId;
          state.total = job.total || state.rows.length;
          state.done = 0;
          state.packs = [];
          state.jobStatus = 'running';
          state.startedAt = Date.now();
          state.etaMs = job.etaMs || 0;
          startPolling();
          draw();
        },
        { variant: 'primary', error: err },
      ),
      progress,
    );
  }

  function startPolling() {
    unmount();
    pollTimer = setInterval(poll, POLL_MS);
    poll();
  }

  async function poll() {
    if (!state.job) return;
    try {
      const data = await call(ACTIONS.RESEARCH_GET, { jobId: state.job });
      state.done = data.done || 0;
      state.total = data.total || state.total;
      state.packs = data.packs || [];
      state.jobStatus = data.status || 'running';
      if (state.jobStatus !== 'running' && state.jobStatus !== 'pending') unmount();
      draw();
    } catch (e) {
      unmount();
      err.show(e);
    }
  }

  function etaText() {
    if (!state.job || state.jobStatus !== 'running') return '';
    const elapsed = Date.now() - state.startedAt;
    const remaining =
      state.done > 0
        ? (elapsed / state.done) * Math.max(0, state.total - state.done)
        : Math.max(0, (state.etaMs || 0) - elapsed);
    return ` · about ${fmtDuration(remaining)} left`;
  }

  /* ---------------- results -------------------------------------------- */

  async function rerunRow(pack, url) {
    const nextRow = { ...pack.row, linkedinUrl: url };
    const job = await call(ACTIONS.RESEARCH_PACK, { rows: [nextRow] });
    state.job = job.jobId;
    state.total = job.total || 1;
    state.done = 0;
    state.jobStatus = 'running';
    state.startedAt = Date.now();
    state.etaMs = job.etaMs || 0;
    startPolling();
    draw();
  }

  function packRow(pack, index) {
    const resolved = pack.resolved || { kind: 'unresolved', confidence: 0 };
    const name = pack.row
      ? pack.row.name || pack.row.linkedinUrl || pack.row.company
      : `Row ${index + 1}`;
    const candidates = resolved.candidates || [];

    const picker = candidates.length
      ? select(
          [
            { value: '', label: `${candidates.length} possible matches…` },
            ...candidates.map((c) => ({
              value: c.url,
              label: `${c.fullName} — ${c.headline || c.company || ''}`.slice(0, 60),
            })),
          ],
          { 'data-picker': String(index) },
        )
      : null;

    return el(
      'div',
      { class: 'item', 'data-pack': String(index) },
      el(
        'div',
        { class: 'item-head' },
        el('span', { class: 'item-title' }, name || '—'),
        el(
          'div',
          { class: 'badges' },
          pill(resolved.kind, kindTone(resolved.kind)),
          resolved.confidence
            ? pill(`${Math.round(resolved.confidence * 100)}% sure`, 'neutral')
            : null,
          (pack.signals || []).length ? pill(`${pack.signals.length} signals`, 'info') : null,
        ),
      ),
      pack.profile
        ? el(
            'div',
            { class: 'item-sub' },
            [pack.profile.title, pack.profile.company].filter(Boolean).join(' · '),
          )
        : null,
      picker
        ? el(
            'div',
            { class: 'row' },
            picker,
            busyButton(
              'Use this',
              async () => {
                if (!picker.value) throw new Error('Pick a match first.');
                await rerunRow(pack, picker.value);
              },
              { variant: 'ghost', error: err },
            ),
          )
        : null,
    );
  }

  function resultsCard() {
    if (!state.job) return null;
    const unresolved = state.packs.filter(
      (p) => !p.resolved || p.resolved.kind === 'unresolved',
    ).length;

    return card(
      'Packs',
      {
        class: 'research-results',
        hint:
          `${fmtNumber(state.done)} of ${fmtNumber(state.total)} · ${state.jobStatus}` +
          `${unresolved ? ` · ${fmtNumber(unresolved)} unresolved` : ''}${etaText()}`,
      },
      state.packs.length
        ? el(
            'div',
            { class: 'itemlist scroll-y' },
            state.packs.map((pack, index) => packRow(pack, index)),
          )
        : empty('Working…'),
      row(
        busyButton(
          'Download output.csv',
          async () => {
            const rows = state.packs.map((p) => p.csvRow).filter(Boolean);
            if (!rows.length) throw new Error('No enriched rows yet.');
            await downloadCsv(`research-${slug(state.job)}-${today()}.csv`, rows);
          },
          { error: err },
        ),
        busyButton(
          'Download packs.md',
          async () => {
            const markdown = state.packs
              .map((p) => p.markdown)
              .filter(Boolean)
              .join('\n\n---\n\n');
            if (!markdown) throw new Error('No packs written yet.');
            await downloadMarkdown(`research-${slug(state.job)}-${today()}.md`, markdown);
          },
          { error: err },
        ),
      ),
    );
  }

  function draw() {
    if (state.job) progress.set(state.done, state.total);
    render(container, [
      err,
      status,
      inputCard(),
      mappingCard(),
      state.rows.length ? optionsCard() : null,
      resultsCard(),
    ]);
  }

  draw();
}
