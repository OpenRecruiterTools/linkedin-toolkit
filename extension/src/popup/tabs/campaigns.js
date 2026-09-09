/**
 * Campaigns tab — the sequence builder and the running campaigns.
 *
 * Steps are the contract `Step` type exactly, branches included, so a sequence
 * built here is the same JSON a sequence file ships.
 */

import { el, render, fmtDate, fmtNumber, fmtDuration } from '../../ui/dom.js';
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
  busyButton,
  button,
  confirmDialog,
  empty,
} from '../../ui/components.js';

export const id = 'campaigns';
export const label = 'Campaigns';

/** Contract Step types, in the order the builder offers them. */
export const STEP_TYPES = [
  { value: 'view', label: 'View profile' },
  { value: 'follow', label: 'Follow' },
  { value: 'invite', label: 'Invite' },
  { value: 'message', label: 'Message' },
  { value: 'inmail', label: 'InMail' },
  { value: 'like', label: 'Like a post' },
  { value: 'comment', label: 'Comment on a post' },
  { value: 'wait', label: 'Wait' },
  { value: 'branch', label: 'Branch' },
];

/** Template variables the helper inserts, with their fallbacks. */
export const VARIABLES = [
  '{{firstName|there}}',
  '{{lastName}}',
  '{{fullName}}',
  '{{company}}',
  '{{title}}',
  '{{headline}}',
];

const BRANCH_ON = [
  { value: 'accepted', label: 'they accepted' },
  { value: 'replied', label: 'they replied' },
  { value: 'notAcceptedAfterMs', label: 'not accepted after…' },
];

const UNITS = [
  { value: '60000', label: 'minutes' },
  { value: '3600000', label: 'hours' },
  { value: '86400000', label: 'days' },
];

const MAX_BRANCH_DEPTH = 2;
const SEQUENCE_INDEX = 'sequences/index.json';

/** A fresh step of the given type. */
export function blankStep(type) {
  if (type === 'wait') return { type, waitMs: 86_400_000 };
  if (type === 'branch') return { type, branch: { on: 'accepted', then: [], else: [] } };
  if (type === 'invite') return { type, note: '' };
  if (type === 'inmail') return { type, subject: '', body: '' };
  if (type === 'message' || type === 'comment') return { type, body: '' };
  return { type };
}

/** Split a millisecond wait into the largest whole unit that fits. */
function splitWait(ms) {
  const value = Number(ms) || 0;
  for (const unit of [86_400_000, 3_600_000, 60_000]) {
    if (value >= unit && value % unit === 0) return { amount: value / unit, unit };
  }
  return { amount: Math.max(1, Math.round(value / 3_600_000)), unit: 3_600_000 };
}

/** Insert text at the caret of a textarea and keep the caret after it. */
function insertAtCaret(node, text) {
  const start = node.selectionStart ?? node.value.length;
  const end = node.selectionEnd ?? node.value.length;
  node.value = `${node.value.slice(0, start)}${text}${node.value.slice(end)}`;
  const caret = start + text.length;
  if (typeof node.setSelectionRange === 'function') node.setSelectionRange(caret, caret);
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.focus();
}

/** Textarea + variables helper + variant alternatives, bound to `step[key]`. */
function messageEditor(step, key, placeholder) {
  const area = textarea({
    placeholder,
    rows: 3,
    'aria-label': placeholder,
    value: step[key] || '',
    oninput: () => {
      step[key] = area.value;
    },
  });

  const variantsHost = el('div', { class: 'itemlist' });

  const drawVariants = () => {
    const variants = step.variants || [];
    render(variantsHost, [
      variants.map((text, index) =>
        el(
          'div',
          { class: 'variant' },
          textarea({
            rows: 2,
            value: text,
            placeholder: `Alternative ${index + 1}`,
            'aria-label': `${placeholder} — alternative ${index + 1}`,
            oninput: (e) => {
              step.variants[index] = e.target.value;
            },
          }),
          button(
            '×',
            () => {
              step.variants.splice(index, 1);
              drawVariants();
            },
            { variant: 'ghost', title: 'Remove this alternative' },
          ),
        ),
      ),
      button(
        '+ Alternative',
        () => {
          step.variants = [...(step.variants || []), ''];
          drawVariants();
        },
        { variant: 'ghost' },
      ),
    ]);
  };
  drawVariants();

  return el(
    'div',
    { class: 'field' },
    area,
    el(
      'div',
      { class: 'vars' },
      VARIABLES.map((token) =>
        el(
          'button',
          {
            type: 'button',
            class: 'var-btn',
            'data-var': token,
            onclick: () => insertAtCaret(area, token),
          },
          token,
        ),
      ),
    ),
    el('p', { class: 'hint' }, 'Alternatives are rotated so no two people get the same words.'),
    variantsHost,
  );
}

/** The body of one step, by type. */
function stepBody(step, depth) {
  if (step.type === 'wait') {
    const { amount, unit } = splitWait(step.waitMs);
    const amountInput = input({ type: 'number', min: 1, value: amount });
    const unitSelect = select(UNITS, { value: String(unit) });
    const sync = () => {
      step.waitMs = Math.max(1, Number(amountInput.value) || 1) * Number(unitSelect.value);
    };
    amountInput.addEventListener('input', sync);
    unitSelect.addEventListener('change', sync);
    return row(field('Wait', amountInput), field('Unit', unitSelect));
  }

  if (step.type === 'invite') {
    return messageEditor(step, 'note', 'Invite note (200 characters on LinkedIn)');
  }
  if (step.type === 'message') {
    return messageEditor(step, 'body', 'Message body');
  }
  if (step.type === 'comment') {
    return messageEditor(step, 'body', 'Comment');
  }
  if (step.type === 'inmail') {
    const subject = input({
      placeholder: 'Subject',
      'aria-label': 'InMail subject',
      value: step.subject || '',
      oninput: () => {
        step.subject = subject.value;
      },
    });
    return el(
      'div',
      { class: 'field' },
      field('Subject', subject),
      messageEditor(step, 'body', 'InMail body'),
    );
  }

  if (step.type === 'branch') {
    const branch = step.branch || (step.branch = { on: 'accepted', then: [], else: [] });
    const onSelect = select(BRANCH_ON, { value: branch.on });
    const msInput = input({
      type: 'number',
      min: 1,
      value: splitWait(branch.ms || 259_200_000).amount,
      hidden: branch.on !== 'notAcceptedAfterMs',
    });
    const msUnit = select(UNITS, {
      value: String(splitWait(branch.ms || 259_200_000).unit),
      hidden: branch.on !== 'notAcceptedAfterMs',
    });
    const syncMs = () => {
      branch.ms = Math.max(1, Number(msInput.value) || 1) * Number(msUnit.value);
    };
    onSelect.addEventListener('change', () => {
      branch.on = onSelect.value;
      const needsMs = branch.on === 'notAcceptedAfterMs';
      msInput.hidden = !needsMs;
      msUnit.hidden = !needsMs;
      if (needsMs) syncMs();
      else delete branch.ms;
    });
    msInput.addEventListener('input', syncMs);
    msUnit.addEventListener('change', syncMs);
    if (branch.on === 'notAcceptedAfterMs') syncMs();

    const thenHost = el('div', { class: 'step-nested', 'data-branch': 'then' });
    const elseHost = el('div', { class: 'step-nested', 'data-branch': 'else' });
    drawSteps(thenHost, branch.then, depth + 1);
    drawSteps(elseHost, branch.else, depth + 1);

    return el(
      'div',
      { class: 'field' },
      row(field('When', onSelect), field('After', msInput), field('Unit', msUnit)),
      el('h3', null, 'Then'),
      thenHost,
      el('h3', null, 'Otherwise'),
      elseHost,
    );
  }

  return null;
}

/** One step card, with reorder and remove. */
function stepNode(step, index, steps, depth, redraw) {
  const typeSelect = select(
    depth >= MAX_BRANCH_DEPTH ? STEP_TYPES.filter((t) => t.value !== 'branch') : STEP_TYPES,
    { value: step.type },
  );
  typeSelect.addEventListener('change', () => {
    steps[index] = blankStep(typeSelect.value);
    redraw();
  });

  const move = (delta) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const [moved] = steps.splice(index, 1);
    steps.splice(target, 0, moved);
    redraw();
  };

  return el(
    'div',
    { class: 'step', 'data-step': String(index) },
    el(
      'div',
      { class: 'step-head' },
      el('span', { class: 'step-index' }, `STEP ${index + 1}`),
      typeSelect,
      el(
        'div',
        { class: 'item-actions' },
        button('↑', () => move(-1), { variant: 'ghost', title: 'Move up' }),
        button('↓', () => move(1), { variant: 'ghost', title: 'Move down' }),
        button(
          '×',
          () => {
            steps.splice(index, 1);
            redraw();
          },
          { variant: 'ghost', title: 'Remove step' },
        ),
      ),
    ),
    stepBody(step, depth),
  );
}

/** Draw a whole step list (used for the top level and both branch arms). */
function drawSteps(host, steps, depth) {
  const redraw = () => drawSteps(host, steps, depth);
  const adder = select(
    depth >= MAX_BRANCH_DEPTH ? STEP_TYPES.filter((t) => t.value !== 'branch') : STEP_TYPES,
    { value: 'view' },
  );

  render(host, [
    steps.length
      ? steps.map((step, i) => stepNode(step, i, steps, depth, redraw))
      : empty('No steps yet.'),
    row(
      adder,
      button(
        '+ Add step',
        () => {
          steps.push(blankStep(adder.value));
          redraw();
        },
        { variant: 'ghost' },
      ),
    ),
  ]);
}

/* ================================================================== */
/*  Sequence templates                                                 */
/* ================================================================== */

/** Read `sequences/index.json` from the extension bundle. */
export async function loadSequenceIndex() {
  const res = await fetch(chrome.runtime.getURL(SEQUENCE_INDEX));
  if (!res.ok) throw new Error('Could not read the bundled sequences.');
  const data = await res.json();
  return data.sequences || [];
}

/** Read one sequence file from the extension bundle. */
export async function loadSequence(file) {
  const res = await fetch(chrome.runtime.getURL(`sequences/${file}`));
  if (!res.ok) throw new Error(`Could not read ${file}.`);
  return res.json();
}

/* ================================================================== */
/*  Tab                                                                */
/* ================================================================== */

function statusTone(status) {
  if (status === 'active') return 'good';
  if (status === 'paused') return 'warn';
  return 'neutral';
}

function statsStrip(stats) {
  if (!stats) return null;
  return el(
    'div',
    { class: 'badges' },
    pill(`${fmtNumber(stats.enrolled || 0)} enrolled`),
    pill(`${fmtNumber(stats.sent || 0)} sent`, 'info'),
    pill(`${fmtNumber(stats.accepted || 0)} accepted`, 'good'),
    pill(`${fmtNumber(stats.replied || 0)} replied`, 'good'),
    pill(`${fmtNumber(stats.positive || 0)} positive`, 'good'),
  );
}

function stepStatsTable(campaign) {
  const byStep = (campaign.stats && campaign.stats.byStep) || {};
  return el(
    'table',
    null,
    el(
      'thead',
      null,
      el(
        'tr',
        null,
        el('th', null, '#'),
        el('th', null, 'Step'),
        el('th', null, 'Sent'),
        el('th', null, 'Accepted'),
        el('th', null, 'Replied'),
      ),
    ),
    el(
      'tbody',
      null,
      (campaign.steps || []).map((step, index) => {
        const stat = byStep[index] || byStep[String(index)] || {};
        const detail =
          step.type === 'wait'
            ? `wait ${fmtDuration(step.waitMs)}`
            : step.type === 'branch'
              ? `branch on ${step.branch ? step.branch.on : '?'}`
              : step.type;
        return el(
          'tr',
          null,
          el('td', null, String(index + 1)),
          el('td', null, detail),
          el('td', null, fmtNumber(stat.sent || 0)),
          el('td', null, stat.accepted === undefined ? '—' : fmtNumber(stat.accepted)),
          el('td', null, stat.replied === undefined ? '—' : fmtNumber(stat.replied)),
        );
      }),
    ),
  );
}

export async function mount(container) {
  const err = errorLine();
  const status = statusLine();
  const state = {
    campaigns: [],
    lists: [],
    templates: [],
    steps: [],
    openId: null,
    openCampaign: null,
  };

  async function loadCampaigns() {
    const data = await call(ACTIONS.CAMPAIGN_GET_ALL, {});
    state.campaigns = data.campaigns || [];
  }

  /* ---------------- running campaigns ------------------------------ */

  function campaignsCard() {
    if (!state.campaigns.length) {
      return card('Campaigns', empty('No campaigns yet. Build one below.'));
    }
    return card(
      'Campaigns',
      el(
        'div',
        { class: 'itemlist' },
        state.campaigns.map((campaign) =>
          el(
            'div',
            { class: 'item', 'data-campaign': campaign.campaignId },
            el(
              'div',
              { class: 'item-head' },
              el('span', { class: 'item-title' }, campaign.name),
              pill(campaign.status, statusTone(campaign.status)),
            ),
            el(
              'div',
              { class: 'item-sub' },
              `${(campaign.steps || []).length} steps · created ${fmtDate(campaign.createdAt)}`,
            ),
            statsStrip(campaign.stats),
            el(
              'div',
              { class: 'item-actions' },
              busyButton(
                campaign.status === 'active' ? 'Pause' : 'Resume',
                async () => {
                  await call(
                    campaign.status === 'active' ? ACTIONS.CAMPAIGN_PAUSE : ACTIONS.CAMPAIGN_RESUME,
                    { campaignId: campaign.campaignId },
                  );
                  await loadCampaigns();
                  draw();
                },
                { variant: 'ghost', error: err },
              ),
              busyButton(
                'Stats',
                async () => {
                  state.openCampaign = await call(ACTIONS.CAMPAIGN_GET, {
                    campaignId: campaign.campaignId,
                  });
                  state.openId = campaign.campaignId;
                  draw();
                },
                { variant: 'ghost', error: err },
              ),
              busyButton(
                'Delete',
                async () => {
                  const sure = await confirmDialog({
                    title: `Delete "${campaign.name}"?`,
                    message: 'Enrolments stop immediately. Anything already sent stays sent.',
                    confirmLabel: 'Delete campaign',
                    danger: true,
                  });
                  if (!sure) return;
                  await call(ACTIONS.CAMPAIGN_DELETE, { campaignId: campaign.campaignId });
                  if (state.openId === campaign.campaignId) {
                    state.openId = null;
                    state.openCampaign = null;
                  }
                  await loadCampaigns();
                  draw();
                },
                { variant: 'danger', error: err },
              ),
            ),
          ),
        ),
      ),
    );
  }

  function statsCard() {
    if (!state.openCampaign) return null;
    return card(
      `${state.openCampaign.name} — per step`,
      { class: 'campaign-stats' },
      statsStrip(state.openCampaign.stats),
      el('div', { class: 'scroll-x' }, stepStatsTable(state.openCampaign)),
      button('Close', () => {
        state.openCampaign = null;
        state.openId = null;
        draw();
      }),
    );
  }

  /* ---------------- builder ----------------------------------------- */

  function builderCard() {
    const name = input({ placeholder: 'Warm connect — Berlin founders' });
    const stepsHost = el('div', { class: 'itemlist', 'data-testid': 'steps' });
    drawSteps(stepsHost, state.steps, 0);

    const templateSelect = select([
      { value: '', label: 'Load a template…' },
      ...state.templates.map((t) => ({ value: t.file, label: t.name })),
    ]);

    const listSelect = select([
      { value: '', label: 'Enrol nobody yet' },
      ...state.lists.map((l) => ({ value: l.listId, label: `${l.name} (${l.count})` })),
    ]);

    const stopOnReply = checkbox('Stop when they reply', { checked: true });
    const autopilot = checkbox('Run this campaign on autopilot');

    return card(
      'Build a campaign',
      { class: 'campaign-builder' },
      field('Name', name),
      row(
        templateSelect,
        busyButton(
          'Load template',
          async () => {
            if (!templateSelect.value) throw new Error('Pick a template first.');
            const sequence = await loadSequence(templateSelect.value);
            state.steps = Array.isArray(sequence.steps) ? sequence.steps : [];
            if (!name.value.trim() && sequence.name) name.value = sequence.name;
            drawSteps(stepsHost, state.steps, 0);
            status.set(`Loaded "${sequence.name}" — ${state.steps.length} steps.`);
          },
          { variant: 'ghost', error: err },
        ),
      ),
      el('h3', null, 'Steps'),
      stepsHost,
      row(field('Enrol from list', listSelect)),
      stopOnReply,
      autopilot,
      busyButton(
        'Create campaign',
        async () => {
          if (!name.value.trim()) throw new Error('Name the campaign first.');
          if (!state.steps.length) throw new Error('A campaign needs at least one step.');
          const params = {
            name: name.value.trim(),
            steps: state.steps,
            settings: {
              stopOnReply: stopOnReply.input.checked,
              autopilot: autopilot.input.checked,
            },
          };
          if (listSelect.value) params.listId = listSelect.value;
          await call(ACTIONS.CAMPAIGN_CREATE, params);
          state.steps = [];
          await loadCampaigns();
          status.set('Campaign created.');
          draw();
        },
        { variant: 'primary', error: err },
      ),
    );
  }

  function draw() {
    render(container, [err, status, campaignsCard(), statsCard(), builderCard()]);
  }

  try {
    await loadCampaigns();
  } catch (e) {
    err.show(e);
  }
  try {
    const data = await call(ACTIONS.LIST_GET_ALL, {});
    state.lists = data.lists || [];
  } catch {
    state.lists = [];
  }
  try {
    state.templates = await loadSequenceIndex();
  } catch {
    state.templates = [];
  }
  draw();
}
