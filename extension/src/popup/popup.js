/**
 * LinkedIn Toolkit — popup shell.
 *
 * Owns the tab bar, the header status pill and the currently mounted tab.
 * Every tab module exports `{ id, label, mount(container, ctx) }` and talks to
 * the engine only through `ui/api.js`.
 */

import { el, render } from '../ui/dom.js';
import { send, getLocal, setLocal, UI_KEYS } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { pill } from '../ui/components.js';

import * as dashboard from './tabs/dashboard.js';
import * as extract from './tabs/extract.js';
import * as lists from './tabs/lists.js';
import * as campaigns from './tabs/campaigns.js';
import * as inbox from './tabs/inbox.js';
import * as queue from './tabs/queue.js';
import * as research from './tabs/research.js';
import * as settings from './tabs/settings.js';

export const TABS = [dashboard, extract, lists, campaigns, inbox, queue, research, settings];

/**
 * Wire the shell into a document (the popup, or a test fixture).
 * @param {{ tabbar: HTMLElement, view: HTMLElement, headStatus?: HTMLElement }} nodes
 */
export function createShell(nodes) {
  const { tabbar, view, headStatus } = nodes;
  let activeId = null;
  let activeTab = null;
  const buttons = new Map();

  const ctx = {
    goTo: (id) => activate(id),
    refreshHeader: () => paintHeader(),
  };

  async function activate(id) {
    const tab = TABS.find((t) => t.id === id) || TABS[0];
    if (activeTab && typeof activeTab.unmount === 'function') {
      try {
        activeTab.unmount();
      } catch (e) {
        console.warn('[LinkedIn Toolkit] unmount failed', e);
      }
    }
    activeId = tab.id;
    activeTab = tab;
    for (const [tabId, btn] of buttons) {
      btn.classList.toggle('is-active', tabId === tab.id);
      btn.setAttribute('aria-selected', tabId === tab.id ? 'true' : 'false');
    }
    await setLocal(UI_KEYS.ACTIVE_TAB, tab.id);
    render(view, el('p', { class: 'empty' }, 'Loading…'));
    try {
      await tab.mount(view, ctx);
    } catch (e) {
      render(view, el('p', { class: 'err' }, `Could not open ${tab.label}: ${e.message}`));
    }
  }

  function paintTabs() {
    render(
      tabbar,
      TABS.map((tab) => {
        const btn = el(
          'button',
          {
            type: 'button',
            class: 'tab',
            role: 'tab',
            'data-tab': tab.id,
            onclick: () => activate(tab.id),
          },
          tab.label,
        );
        buttons.set(tab.id, btn);
        return btn;
      }),
    );
  }

  async function paintHeader() {
    if (!headStatus) return;
    const envelope = await send(ACTIONS.STATUS_GET, {});
    if (!envelope.ok) {
      render(headStatus, pill('engine offline', 'bad'));
      return;
    }
    const status = envelope.data || {};
    const nodesOut = [
      status.loggedIn ? pill('LinkedIn ✓', 'good') : pill('signed out', 'bad'),
      status.autopilot ? pill('Autopilot', 'warn') : pill('Copilot', 'info'),
    ];
    if (status.queue && status.queue.pending > 0) {
      nodesOut.push(pill(`${status.queue.pending} queued`, 'warn'));
    }
    render(headStatus, nodesOut);
  }

  return {
    async start() {
      paintTabs();
      const saved = await getLocal(UI_KEYS.ACTIVE_TAB, TABS[0].id);
      await activate(TABS.some((t) => t.id === saved) ? saved : TABS[0].id);
      await paintHeader();
    },
    activate,
    paintHeader,
    get activeId() {
      return activeId;
    },
  };
}

/* istanbul ignore next — browser bootstrap, exercised by the smoke checklist */
if (typeof document !== 'undefined' && document.getElementById('tabbar')) {
  const shell = createShell({
    tabbar: document.getElementById('tabbar'),
    view: document.getElementById('view'),
    headStatus: document.getElementById('head-status'),
  });
  const optionsBtn = document.getElementById('open-options');
  if (optionsBtn) {
    optionsBtn.addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    });
  }
  const version = document.getElementById('app-version');
  if (version && chrome.runtime.getManifest) {
    const manifest = chrome.runtime.getManifest();
    version.textContent = `v${manifest.version} · local-first`;
  }
  shell.start();
}
