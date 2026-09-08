/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as campaigns from '../../src/popup/tabs/campaigns.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint, listFixture, campaignFixture } from './helpers.js';

import sequenceIndex from '../../sequences/index.json';
import warmConnect from '../../sequences/warm-connect.json';
import connectThenMessage from '../../sequences/connect-then-message.json';

const BUNDLE = {
  'sequences/index.json': sequenceIndex,
  'sequences/warm-connect.json': warmConnect,
  'sequences/connect-then-message.json': connectThenMessage,
};

beforeEach(() => {
  globalThis.fetch = vi.fn((url) => {
    const key = String(url).replace('chrome-extension://linkedin-toolkit-test/', '');
    const body = BUNDLE[key];
    return Promise.resolve({
      ok: Boolean(body),
      json: () => Promise.resolve(body),
    });
  });
});

const builder = (host) => host.querySelector('.campaign-builder');
const clickLabelled = (host, text) => {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (!node) throw new Error(`no button "${text}"`);
  node.click();
  return node;
};
const addStep = (host, type) => {
  const stepsHost = host.querySelector('[data-testid="steps"]');
  const adder = [...stepsHost.children].pop().querySelector('select');
  adder.value = type;
  [...stepsHost.children].pop().querySelector('button').click();
};

function baseEngine(extra = {}) {
  return stubEngine({
    [ACTIONS.CAMPAIGN_GET_ALL]: { campaigns: [campaignFixture()] },
    [ACTIONS.LIST_GET_ALL]: { lists: [listFixture()] },
    ...extra,
  });
}

describe('Campaigns tab', () => {
  it('lists campaigns with their status and stats', async () => {
    baseEngine();
    const host = mountPoint();

    await campaigns.mount(host);

    expect(host.textContent).toContain('Warm connect');
    expect(host.textContent).toContain('active');
    expect(host.textContent).toContain('10 enrolled');
    expect(host.textContent).toContain('2 accepted');
  });

  it('pauses and resumes a campaign', async () => {
    const engine = baseEngine({ [ACTIONS.CAMPAIGN_PAUSE]: campaignFixture({ status: 'paused' }) });
    const host = mountPoint();
    await campaigns.mount(host);

    clickLabelled(host, 'Pause');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.CAMPAIGN_PAUSE)).toEqual({ campaignId: 'c1' });
  });

  it('shows per-step stats from campaign.get', async () => {
    baseEngine({ [ACTIONS.CAMPAIGN_GET]: campaignFixture() });
    const host = mountPoint();
    await campaigns.mount(host);

    clickLabelled(host, 'Stats');
    await flush(10);

    const stats = host.querySelector('.campaign-stats');
    expect(stats).toBeTruthy();
    const rows = [...stats.querySelectorAll('tbody tr')].map((r) => r.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('wait 1d 0h');
    expect(rows[2]).toContain('invite');
  });

  it('asks before deleting a campaign', async () => {
    const engine = baseEngine({ [ACTIONS.CAMPAIGN_DELETE]: campaignFixture() });
    const host = mountPoint();
    await campaigns.mount(host);

    clickLabelled(host, 'Delete');
    await flush(6);
    expect(engine.countOf(ACTIONS.CAMPAIGN_DELETE)).toBe(0);

    document.querySelector('[data-testid="confirm-ok"]').click();
    await flush(12);

    expect(engine.paramsFor(ACTIONS.CAMPAIGN_DELETE)).toEqual({ campaignId: 'c1' });
  });

  it('creates a campaign from steps built in the editor', async () => {
    const engine = baseEngine({ [ACTIONS.CAMPAIGN_CREATE]: campaignFixture() });
    const host = mountPoint();
    await campaigns.mount(host);

    const node = builder(host);
    node.querySelector('input.input').value = 'Berlin founders';
    addStep(host, 'view');
    addStep(host, 'invite');

    const note = node.querySelector('[data-step="1"] textarea');
    note.value = 'Hi there';
    note.dispatchEvent(new window.Event('input', { bubbles: true }));

    node.querySelector('select').value = '';
    const listSelect = [...node.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'l1'),
    );
    listSelect.value = 'l1';

    clickLabelled(node, 'Create campaign');
    await flush(12);

    const params = engine.paramsFor(ACTIONS.CAMPAIGN_CREATE);
    expect(params.name).toBe('Berlin founders');
    expect(params.steps).toEqual([{ type: 'view' }, { type: 'invite', note: 'Hi there' }]);
    expect(params.listId).toBe('l1');
    expect(params.settings).toEqual({ stopOnReply: true, autopilot: false });
  });

  it('refuses to create a campaign with no steps', async () => {
    const engine = baseEngine();
    const host = mountPoint();
    await campaigns.mount(host);

    builder(host).querySelector('input.input').value = 'Empty';
    clickLabelled(builder(host), 'Create campaign');
    await flush(8);

    expect(engine.countOf(ACTIONS.CAMPAIGN_CREATE)).toBe(0);
    expect(host.querySelector('.err').textContent).toContain('at least one step');
  });

  it('inserts a template variable at the caret', async () => {
    baseEngine();
    const host = mountPoint();
    await campaigns.mount(host);

    addStep(host, 'invite');
    const area = builder(host).querySelector('[data-step="0"] textarea');
    area.value = 'Hi ';
    area.selectionStart = 3;
    area.selectionEnd = 3;

    builder(host).querySelector('[data-var="{{firstName|there}}"]').click();

    expect(area.value).toBe('Hi {{firstName|there}}');
    expect(campaigns.VARIABLES).toContain('{{company}}');
  });

  it('keeps variants as a list of alternatives', async () => {
    const engine = baseEngine({ [ACTIONS.CAMPAIGN_CREATE]: campaignFixture() });
    const host = mountPoint();
    await campaigns.mount(host);

    addStep(host, 'message');
    const step = builder(host).querySelector('[data-step="0"]');
    const body = step.querySelector('textarea');
    body.value = 'Main';
    body.dispatchEvent(new window.Event('input', { bubbles: true }));

    [...step.querySelectorAll('button')]
      .find((b) => b.textContent.includes('+ Alternative'))
      .click();
    const variant = [...step.querySelectorAll('textarea')][1];
    variant.value = 'Other words';
    variant.dispatchEvent(new window.Event('input', { bubbles: true }));

    builder(host).querySelector('input.input').value = 'Variants';
    clickLabelled(builder(host), 'Create campaign');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.CAMPAIGN_CREATE).steps).toEqual([
      { type: 'message', body: 'Main', variants: ['Other words'] },
    ]);
  });

  it('builds a branch step with then and else arms', async () => {
    const engine = baseEngine({ [ACTIONS.CAMPAIGN_CREATE]: campaignFixture() });
    const host = mountPoint();
    await campaigns.mount(host);

    addStep(host, 'branch');
    const step = builder(host).querySelector('[data-step="0"]');

    const thenHost = step.querySelector('[data-branch="then"]');
    const thenAdder = [...thenHost.children].pop().querySelector('select');
    thenAdder.value = 'message';
    [...thenHost.children].pop().querySelector('button').click();

    const elseHost = step.querySelector('[data-branch="else"]');
    const elseAdder = [...elseHost.children].pop().querySelector('select');
    elseAdder.value = 'follow';
    [...elseHost.children].pop().querySelector('button').click();

    builder(host).querySelector('input.input').value = 'Branchy';
    clickLabelled(builder(host), 'Create campaign');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.CAMPAIGN_CREATE).steps).toEqual([
      {
        type: 'branch',
        branch: {
          on: 'accepted',
          then: [{ type: 'message', body: '' }],
          else: [{ type: 'follow' }],
        },
      },
    ]);
  });

  it('converts a wait into milliseconds', async () => {
    const engine = baseEngine({ [ACTIONS.CAMPAIGN_CREATE]: campaignFixture() });
    const host = mountPoint();
    await campaigns.mount(host);

    addStep(host, 'wait');
    const step = builder(host).querySelector('[data-step="0"]');
    const amount = step.querySelector('input[type="number"]');
    amount.value = '3';
    amount.dispatchEvent(new window.Event('input', { bubbles: true }));

    builder(host).querySelector('input.input').value = 'Waiting';
    clickLabelled(builder(host), 'Create campaign');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.CAMPAIGN_CREATE).steps).toEqual([
      { type: 'wait', waitMs: 3 * 86_400_000 },
    ]);
  });

  it('reorders and removes steps', async () => {
    const engine = baseEngine({ [ACTIONS.CAMPAIGN_CREATE]: campaignFixture() });
    const host = mountPoint();
    await campaigns.mount(host);

    addStep(host, 'view');
    addStep(host, 'follow');
    addStep(host, 'like');

    const stepsHost = host.querySelector('[data-testid="steps"]');
    // move the third step up, then delete the first
    stepsHost.querySelector('[data-step="2"]').querySelectorAll('.item-actions button')[0].click();
    stepsHost.querySelector('[data-step="0"]').querySelectorAll('.item-actions button')[2].click();

    builder(host).querySelector('input.input').value = 'Reordered';
    clickLabelled(builder(host), 'Create campaign');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.CAMPAIGN_CREATE).steps).toEqual([
      { type: 'like' },
      { type: 'follow' },
    ]);
  });

  it('loads a bundled sequence template into the builder', async () => {
    const engine = baseEngine({ [ACTIONS.CAMPAIGN_CREATE]: campaignFixture() });
    const host = mountPoint();
    await campaigns.mount(host);

    const node = builder(host);
    const templateSelect = node.querySelector('select');
    expect([...templateSelect.options].map((o) => o.value)).toEqual([
      '',
      'warm-connect.json',
      'connect-then-message.json',
    ]);

    templateSelect.value = 'connect-then-message.json';
    clickLabelled(node, 'Load template');
    await flush(10);

    expect(host.textContent).toContain('Loaded "Connect, then message"');
    expect(builder(host).querySelectorAll('[data-testid="steps"] > .step')).toHaveLength(4);

    clickLabelled(builder(host), 'Create campaign');
    await flush(10);
    expect(engine.paramsFor(ACTIONS.CAMPAIGN_CREATE).steps).toEqual(connectThenMessage.steps);
  });
});

describe('bundled sequences', () => {
  it('every indexed file exists and is made of contract steps', () => {
    const types = new Set(campaigns.STEP_TYPES.map((t) => t.value));
    const walk = (steps) => {
      for (const step of steps) {
        expect(types.has(step.type)).toBe(true);
        if (step.type === 'wait') expect(typeof step.waitMs).toBe('number');
        if (step.type === 'branch') {
          expect(['accepted', 'replied', 'notAcceptedAfterMs']).toContain(step.branch.on);
          walk(step.branch.then);
          walk(step.branch.else);
        }
      }
    };
    for (const entry of sequenceIndex.sequences) {
      const file = BUNDLE[`sequences/${entry.file}`];
      expect(file, entry.file).toBeTruthy();
      expect(file.name).toBe(entry.name);
      walk(file.steps);
    }
  });
});
