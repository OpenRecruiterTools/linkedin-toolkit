/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import { renderSettings, PRESET_DEFAULTS, AI_FIELDS } from '../../src/ui/settings.js';
import { extraCards, start } from '../../src/options/options.js';
import { ACTIONS, HARD_CAPS } from '../../src/lib/actions.js';
import { UI_KEYS } from '../../src/ui/api.js';
import { stubEngine, flush, mountPoint, statusFixture, configFixture } from './helpers.js';

const clickIn = (host, text) => {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (!node) throw new Error(`no button "${text}"`);
  node.click();
  return node;
};

const change = (node, value) => {
  node.value = value;
  node.dispatchEvent(new window.Event('input', { bubbles: true }));
  node.dispatchEvent(new window.Event('change', { bubbles: true }));
};

function settingsEngine(config = {}, extra = {}) {
  return stubEngine({
    [ACTIONS.CONFIG_GET]: configFixture(config),
    [ACTIONS.STATUS_GET]: statusFixture(),
    [ACTIONS.CONFIG_SET]: (params) => configFixture({ ...config, ...params }),
    ...extra,
  });
}

describe('settings form', () => {
  it('renders every contract Config field with its hard cap', async () => {
    settingsEngine();
    const host = mountPoint();

    await renderSettings(host);

    expect(host.textContent).toContain('Hard cap: 100');
    expect(host.textContent).toContain('Hard cap: 150');
    expect(host.textContent).toContain('Hard cap: 500');
    expect(host.textContent).toContain('Hard cap: 1,000');
    expect(host.querySelector('[data-cap="dailyInviteCap"]').value).toBe('25');
    expect(host.querySelector('[data-cap="dailyInviteCap"]').max).toBe(
      String(HARD_CAPS.dailyInviteCap),
    );
  });

  it('clamps a cap in the input as it is typed', async () => {
    const engine = settingsEngine();
    const host = mountPoint();
    await renderSettings(host);

    const cap = host.querySelector('[data-cap="dailyMessageCap"]');
    change(cap, '99999');
    expect(cap.value).toBe(String(HARD_CAPS.dailyMessageCap));

    clickIn(host, 'Save settings');
    await flush(8);
    expect(engine.paramsFor(ACTIONS.CONFIG_SET).dailyMessageCap).toBe(HARD_CAPS.dailyMessageCap);
  });

  it('applies a preset to the pacing fields', async () => {
    settingsEngine();
    const host = mountPoint();
    await renderSettings(host);

    const preset = host.querySelector('select');
    change(preset, 'salesnav');

    expect(host.querySelector('[data-cap="dailyInviteCap"]').value).toBe(
      String(PRESET_DEFAULTS.salesnav.dailyInviteCap),
    );
    expect(host.textContent).toContain('Applied the salesnav pacing');
  });

  it('saves the whole form through config.set', async () => {
    const engine = settingsEngine();
    const host = mountPoint();
    await renderSettings(host);

    clickIn(host, 'Save settings');
    await flush(8);

    const patch = engine.paramsFor(ACTIONS.CONFIG_SET);
    expect(patch.accountPreset).toBe('free');
    expect(patch.minDelayMs).toBe(8000);
    expect(patch.businessHoursOnly).toBe(true);
    expect(patch.businessStart).toBe(9);
    expect(patch.weekdaysOnly).toBe(true);
    expect(patch.warmup.enabled).toBe(false);
    expect(patch.ai).toEqual({ provider: 'none' });
    expect(patch.bridge).toEqual({ enabled: false, port: 47829 });
    expect(host.textContent).toContain('Saved.');
  });

  it('shows only the fields the chosen AI provider uses', async () => {
    settingsEngine();
    const host = mountPoint();
    await renderSettings(host);

    const provider = [...host.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'ollama'),
    );
    const fieldFor = (labelText) =>
      [...host.querySelectorAll('.field')].find(
        (f) =>
          f.querySelector('.field-label') &&
          f.querySelector('.field-label').textContent === labelText,
      );

    expect(fieldFor('Model').hidden).toBe(true);

    change(provider, 'ollama');
    expect(fieldFor('Model').hidden).toBe(false);
    expect(fieldFor('Base URL').hidden).toBe(false);
    expect(fieldFor('API key').hidden).toBe(true);

    change(provider, 'anthropic');
    expect(fieldFor('Base URL').hidden).toBe(true);
    expect(fieldFor('API key').hidden).toBe(false);
    expect(AI_FIELDS['openai-compatible']).toEqual(['model', 'baseUrl', 'apiKey']);
  });

  it('tests the AI provider with a summary of "Hello"', async () => {
    const engine = settingsEngine(
      {},
      {
        [ACTIONS.AI_COMPLETE]: { output: 'A greeting.', provider: 'ollama', model: 'llama3' },
      },
    );
    const host = mountPoint();
    await renderSettings(host);

    const provider = [...host.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'ollama'),
    );
    change(provider, 'ollama');
    clickIn(host, 'Test');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.AI_COMPLETE)).toEqual({
      task: 'summary',
      input: { text: 'Hello' },
    });
    expect(engine.paramsFor(ACTIONS.CONFIG_SET).ai.provider).toBe('ollama');
    expect(host.textContent).toContain('ollama · llama3: A greeting.');
  });

  it('reports the bridge connection state from status.get', async () => {
    stubEngine({
      [ACTIONS.CONFIG_GET]: configFixture({ bridge: { enabled: true, port: 47829 } }),
      [ACTIONS.STATUS_GET]: statusFixture({
        bridge: { enabled: true, connected: true, port: 47829 },
      }),
    });
    const host = mountPoint();

    await renderSettings(host);

    expect(host.textContent).toContain('connected');
  });

  it('sends the bridge token only when one was pasted', async () => {
    const engine = settingsEngine();
    const host = mountPoint();
    await renderSettings(host);

    const token = [...host.querySelectorAll('input.input')].find(
      (i) => i.placeholder === 'paste the pairing token',
    );
    change(token, 'abc123');
    clickIn(host, 'Save settings');
    await flush(8);

    expect(engine.paramsFor(ACTIONS.CONFIG_SET).bridge.token).toBe('abc123');
  });

  it('mirrors the enrichment block locally as well as into config.set', async () => {
    const engine = settingsEngine();
    const host = mountPoint();
    await renderSettings(host);

    const enrich = [...host.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'hunter'),
    );
    change(enrich, 'hunter');
    const key = [...host.querySelectorAll('input.input')].find(
      (i) => i.placeholder === 'provider API key',
    );
    change(key, 'hunter-key');

    clickIn(host, 'Save settings');
    await flush(8);

    expect(engine.paramsFor(ACTIONS.CONFIG_SET).enrichment).toEqual({
      provider: 'hunter',
      apiKey: 'hunter-key',
    });
    const stored = await chrome.storage.local.get(UI_KEYS.ENRICHMENT);
    expect(stored[UI_KEYS.ENRICHMENT]).toEqual({ provider: 'hunter', apiKey: 'hunter-key' });
  });

  it('reports an offline engine instead of drawing a blank form', async () => {
    stubEngine({});
    const host = mountPoint();

    const ctx = await renderSettings(host);

    expect(ctx).toBeNull();
    expect(host.querySelector('.err').hidden).toBe(false);
  });
});

describe('options page', () => {
  function optionsFixture() {
    document.body.textContent = '';
    const view = document.createElement('main');
    const headStatus = document.createElement('div');
    document.body.append(view, headStatus);
    return { view, headStatus };
  }

  it('draws the settings form plus the extra cards', async () => {
    settingsEngine();
    const nodes = optionsFixture();

    await start(nodes);

    expect(nodes.headStatus.textContent).toContain('Copilot');
    expect(nodes.view.textContent).toContain('Daily caps');
    expect(nodes.view.textContent).toContain('Settings file');
    expect(nodes.view.textContent).toContain('Danger zone');
  });

  it('exports the settings as JSON', async () => {
    settingsEngine();
    const nodes = optionsFixture();
    await start(nodes);

    clickIn(nodes.view, 'Export settings');
    await flush(10);

    const download = chrome.__mock.downloads[0];
    expect(download.filename).toMatch(/^linkedin-toolkit-settings-\d{4}-\d{2}-\d{2}\.json$/);
    expect(decodeURIComponent(download.url)).toContain('dailyInviteCap');
  });

  it('imports a settings file through config.set', async () => {
    const engine = settingsEngine();
    const nodes = optionsFixture();
    await start(nodes);

    const fileInput = nodes.view.querySelector('input[type="file"]');
    const file = new window.File([JSON.stringify({ hourlyCap: 12 })], 'settings.json', {
      type: 'application/json',
    });
    Object.defineProperty(fileInput, 'files', { value: [file] });

    clickIn(nodes.view, 'Import settings');
    await flush(14);

    expect(engine.paramsFor(ACTIONS.CONFIG_SET)).toEqual({ hourlyCap: 12 });
  });

  it('refuses a settings file that is not JSON', async () => {
    settingsEngine();
    const nodes = optionsFixture();
    await start(nodes);

    const fileInput = nodes.view.querySelector('input[type="file"]');
    const file = new window.File(['not json at all'], 'settings.json', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', { value: [file] });

    clickIn(nodes.view, 'Import settings');
    await flush(14);

    expect(nodes.view.querySelector('.err').textContent).toContain('not valid JSON');
  });

  it('clears all data only after the typed confirmation', async () => {
    settingsEngine();
    const nodes = optionsFixture();
    await start(nodes);
    await chrome.storage.local.set({ 'lists.something': [1, 2, 3] });

    clickIn(nodes.view, 'Clear all data');
    await flush(6);

    const dialog = document.querySelector('[data-testid="confirm-dialog"]');
    const ok = dialog.querySelector('[data-testid="confirm-ok"]');
    expect(ok.disabled).toBe(true);

    const typed = dialog.querySelector('[data-testid="confirm-typed"]');
    change(typed, 'nope');
    expect(ok.disabled).toBe(true);
    change(typed, 'ERASE');
    expect(ok.disabled).toBe(false);

    ok.click();
    await flush(12);

    expect(await chrome.storage.local.get('lists.something')).toEqual({});
  });

  it('exposes the extra cards for reuse', () => {
    const ctx = { error: { show() {} }, status: { set() {} }, reload: async () => {} };
    expect(extraCards(ctx)).toHaveLength(2);
  });
});
