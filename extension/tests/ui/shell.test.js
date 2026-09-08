/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import { createShell, TABS } from '../../src/popup/popup.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { UI_KEYS } from '../../src/ui/api.js';
import { stubEngine, statusFixture, configFixture } from './helpers.js';

function fixture() {
  document.body.textContent = '';
  const tabbar = document.createElement('nav');
  const view = document.createElement('main');
  const headStatus = document.createElement('div');
  document.body.append(tabbar, view, headStatus);
  return { tabbar, view, headStatus };
}

const defaultEngine = () =>
  stubEngine({
    [ACTIONS.STATUS_GET]: statusFixture(),
    [ACTIONS.CONFIG_GET]: configFixture(),
  });

describe('popup shell', () => {
  it('exposes the eight contract tabs in order', () => {
    expect(TABS.map((t) => t.id)).toEqual([
      'dashboard',
      'extract',
      'lists',
      'campaigns',
      'inbox',
      'queue',
      'research',
      'settings',
    ]);
    for (const tab of TABS) {
      expect(typeof tab.label).toBe('string');
      expect(typeof tab.mount).toBe('function');
    }
  });

  it('draws a tab bar and mounts the dashboard first', async () => {
    defaultEngine();
    const nodes = fixture();
    const shell = createShell(nodes);

    await shell.start();

    expect(nodes.tabbar.querySelectorAll('.tab')).toHaveLength(8);
    expect(nodes.tabbar.querySelector('.is-active').dataset.tab).toBe('dashboard');
    expect(nodes.view.textContent).toContain('Connection');
  });

  it('remembers the active tab in chrome.storage.local', async () => {
    defaultEngine();
    const shell = createShell(fixture());
    await shell.start();

    await shell.activate('queue');

    expect(shell.activeId).toBe('queue');
    const stored = await chrome.storage.local.get(UI_KEYS.ACTIVE_TAB);
    expect(stored[UI_KEYS.ACTIVE_TAB]).toBe('queue');
  });

  it('restores the remembered tab on the next open', async () => {
    defaultEngine();
    await chrome.storage.local.set({ [UI_KEYS.ACTIVE_TAB]: 'campaigns' });
    const nodes = fixture();
    const shell = createShell(nodes);

    await shell.start();

    expect(shell.activeId).toBe('campaigns');
    expect(nodes.tabbar.querySelector('.is-active').dataset.tab).toBe('campaigns');
  });

  it('falls back to the dashboard when the remembered tab is gone', async () => {
    defaultEngine();
    await chrome.storage.local.set({ [UI_KEYS.ACTIVE_TAB]: 'atlantis' });
    const shell = createShell(fixture());

    await shell.start();

    expect(shell.activeId).toBe('dashboard');
  });

  it('summarises login, mode and queue depth in the header', async () => {
    defaultEngine();
    const nodes = fixture();
    const shell = createShell(nodes);

    await shell.start();

    expect(nodes.headStatus.textContent).toContain('LinkedIn ✓');
    expect(nodes.headStatus.textContent).toContain('Copilot');
    expect(nodes.headStatus.textContent).toContain('2 queued');
  });

  it('says so when the engine is offline', async () => {
    stubEngine({});
    const nodes = fixture();
    const shell = createShell(nodes);

    await shell.start();

    expect(nodes.headStatus.textContent).toContain('engine offline');
  });
});
