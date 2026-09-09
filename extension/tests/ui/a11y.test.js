/**
 * @vitest-environment jsdom
 *
 * Keyboard and labelling guarantees. Everything a mouse can reach in the popup
 * must be reachable from the keyboard, and every free-text control must carry
 * an accessible name.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { activatable } from '../../src/ui/components.js';
import { createShell, TABS } from '../../src/popup/popup.js';
import * as research from '../../src/popup/tabs/research.js';
import * as lists from '../../src/popup/tabs/lists.js';
import * as inbox from '../../src/popup/tabs/inbox.js';
import * as queue from '../../src/popup/tabs/queue.js';
import * as campaigns from '../../src/popup/tabs/campaigns.js';
import { ACTIONS } from '../../src/lib/actions.js';
import {
  stubEngine,
  flush,
  mountPoint,
  statusFixture,
  configFixture,
  listFixture,
  campaignFixture,
  threadFixture,
  queueItemFixture,
  profileFixture,
} from './helpers.js';

const press = (node, key) =>
  node.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

/** Every free-text control must be named by aria-label or a wrapping label. */
function accessibleName(node) {
  const aria = node.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();
  if (node.id) {
    const forLabel = node.ownerDocument.querySelector(`label[for="${node.id}"]`);
    if (forLabel) return forLabel.textContent.trim();
  }
  const wrapping = node.closest('label');
  if (wrapping) {
    const labelText = wrapping.querySelector('.field-label');
    return (labelText ? labelText.textContent : wrapping.textContent).trim();
  }
  return '';
}

const unnamedTextControls = (host) =>
  [...host.querySelectorAll('textarea, input[type="text"], input:not([type])')]
    .filter((node) => !accessibleName(node))
    .map((node) => node.placeholder || node.outerHTML.slice(0, 80));

afterEach(() => {
  research.unmount();
  vi.useRealTimers();
});

/* ================================================================== */
/*  activatable()                                                      */
/* ================================================================== */

describe('activatable', () => {
  it('gives a plain element button semantics and a tab stop', () => {
    const node = activatable(document.createElement('div'), () => {}, { label: 'Do it' });
    expect(node.getAttribute('role')).toBe('button');
    expect(node.getAttribute('tabindex')).toBe('0');
    expect(node.getAttribute('aria-label')).toBe('Do it');
  });

  it('fires on click, Enter and Space — and on nothing else', () => {
    const handler = vi.fn();
    const node = activatable(document.createElement('div'), handler);

    node.click();
    press(node, 'Enter');
    press(node, ' ');
    expect(handler).toHaveBeenCalledTimes(3);

    press(node, 'a');
    press(node, 'Tab');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('stops Space from scrolling the popup', () => {
    const node = activatable(document.createElement('div'), () => {});
    const event = new window.KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    node.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

/* ================================================================== */
/*  Research drop-zone                                                 */
/* ================================================================== */

describe('Research drop-zone', () => {
  it('is focusable and announced as a button', async () => {
    stubEngine({});
    const host = mountPoint();
    await research.mount(host);

    const drop = host.querySelector('[data-testid="dropzone"]');
    expect(drop.getAttribute('role')).toBe('button');
    expect(drop.getAttribute('tabindex')).toBe('0');
    expect(drop.getAttribute('aria-label')).toBe('Choose a CSV file');
  });

  it('opens the file picker from the keyboard as well as the mouse', async () => {
    stubEngine({});
    const host = mountPoint();
    await research.mount(host);

    const drop = host.querySelector('[data-testid="dropzone"]');
    const fileInput = host.querySelector('input[type="file"]');
    const clicks = vi.spyOn(fileInput, 'click').mockImplementation(() => {});

    drop.focus();
    press(drop, 'Enter');
    expect(clicks).toHaveBeenCalledTimes(1);

    press(drop, ' ');
    expect(clicks).toHaveBeenCalledTimes(2);

    drop.click();
    expect(clicks).toHaveBeenCalledTimes(3);
  });

  it('names the paste box', async () => {
    stubEngine({});
    const host = mountPoint();
    await research.mount(host);

    expect(host.querySelector('textarea').getAttribute('aria-label')).toBe('Paste CSV rows');
    expect(unnamedTextControls(host)).toEqual([]);
  });
});

/* ================================================================== */
/*  Lists rows                                                         */
/* ================================================================== */

describe('Lists row selector', () => {
  const listsEngine = () =>
    stubEngine({
      [ACTIONS.LIST_GET_ALL]: {
        lists: [listFixture(), listFixture({ listId: 'l2', name: 'Berlin', count: 4 })],
      },
      [ACTIONS.CAMPAIGN_GET_ALL]: { campaigns: [campaignFixture()] },
      [ACTIONS.LIST_MEMBERS]: {
        members: [
          { publicId: 'ada', profile: profileFixture(), addedAt: 1, tags: [], signals: [] },
        ],
        total: 1,
      },
    });

  it('exposes each row as a focusable button with its selected state', async () => {
    listsEngine();
    const host = mountPoint();
    await lists.mount(host);

    const rows = [...host.querySelectorAll('[data-list]')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute('role')).toBe('button');
      expect(row.getAttribute('tabindex')).toBe('0');
      expect(row.getAttribute('aria-label')).toMatch(/^Open list /);
    }
    expect(rows[0].getAttribute('aria-pressed')).toBe('true');
    expect(rows[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('selects a list with Enter', async () => {
    const engine = listsEngine();
    const host = mountPoint();
    await lists.mount(host);

    const second = host.querySelector('[data-list="l2"]');
    second.focus();
    press(second, 'Enter');
    await flush(10);

    expect(engine.allParamsFor(ACTIONS.LIST_MEMBERS).pop().listId).toBe('l2');
    expect(host.querySelector('[data-list="l2"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('selects a list with Space', async () => {
    const engine = listsEngine();
    const host = mountPoint();
    await lists.mount(host);

    const second = host.querySelector('[data-list="l2"]');
    second.focus();
    press(second, ' ');
    await flush(10);

    expect(engine.allParamsFor(ACTIONS.LIST_MEMBERS).pop().listId).toBe('l2');
  });

  it('names the member checkboxes', async () => {
    listsEngine();
    const host = mountPoint();
    await lists.mount(host);

    expect(host.querySelector('input[data-member]').getAttribute('aria-label')).toBe(
      'Select Ada Lovelace',
    );
  });
});

/* ================================================================== */
/*  Tab bar                                                           */
/* ================================================================== */

describe('tab bar', () => {
  function fixture() {
    document.body.textContent = '';
    const tabbar = document.createElement('nav');
    const view = document.createElement('main');
    const headStatus = document.createElement('div');
    document.body.append(tabbar, view, headStatus);
    return { tabbar, view, headStatus };
  }

  const shellEngine = () =>
    stubEngine({
      [ACTIONS.STATUS_GET]: statusFixture(),
      [ACTIONS.CONFIG_GET]: configFixture(),
    });

  it('is a tablist of tabs with a roving tab stop', async () => {
    shellEngine();
    const nodes = fixture();
    const shell = createShell(nodes);
    await shell.start();

    expect(nodes.tabbar.getAttribute('role')).toBe('tablist');
    expect(nodes.view.getAttribute('role')).toBe('tabpanel');

    const tabs = [...nodes.tabbar.querySelectorAll('.tab')];
    expect(tabs.every((t) => t.getAttribute('role') === 'tab')).toBe(true);
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('moves right and left with the arrow keys, wrapping at both ends', async () => {
    shellEngine();
    const nodes = fixture();
    const shell = createShell(nodes);
    await shell.start();

    press(nodes.tabbar, 'ArrowRight');
    await flush(6);
    expect(shell.activeId).toBe(TABS[1].id);
    expect(nodes.tabbar.querySelector('[data-tab="extract"]').getAttribute('tabindex')).toBe('0');

    press(nodes.tabbar, 'ArrowLeft');
    await flush(6);
    expect(shell.activeId).toBe(TABS[0].id);

    // wraps backwards off the first tab onto the last
    press(nodes.tabbar, 'ArrowLeft');
    await flush(6);
    expect(shell.activeId).toBe(TABS[TABS.length - 1].id);

    // and forwards off the last back onto the first
    press(nodes.tabbar, 'ArrowRight');
    await flush(6);
    expect(shell.activeId).toBe(TABS[0].id);
  });

  it('jumps to the ends with Home and End, and ignores other keys', async () => {
    shellEngine();
    const nodes = fixture();
    const shell = createShell(nodes);
    await shell.start();

    press(nodes.tabbar, 'End');
    await flush(6);
    expect(shell.activeId).toBe(TABS[TABS.length - 1].id);

    press(nodes.tabbar, 'Home');
    await flush(6);
    expect(shell.activeId).toBe(TABS[0].id);

    press(nodes.tabbar, 'x');
    await flush(4);
    expect(shell.activeId).toBe(TABS[0].id);
  });

  it('stops the arrow key from scrolling the strip', async () => {
    shellEngine();
    const nodes = fixture();
    await createShell(nodes).start();

    const event = new window.KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    nodes.tabbar.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

/* ================================================================== */
/*  Labels on the remaining free-text controls                         */
/* ================================================================== */

describe('accessible names', () => {
  it('names the inbox reply box and the saved-reply input', async () => {
    stubEngine({
      [ACTIONS.INBOX_THREADS]: { threads: [threadFixture()] },
      [ACTIONS.INBOX_MESSAGES]: { messages: [] },
    });
    const host = mountPoint();
    await inbox.mount(host);

    [...host.querySelectorAll('button')].find((b) => b.textContent.includes('Open')).click();
    await flush(8);

    expect(host.querySelector('.thread textarea').getAttribute('aria-label')).toBe(
      'Reply to Ada Lovelace',
    );
    const draft = [...host.querySelectorAll('input.input')].pop();
    expect(draft.getAttribute('aria-label')).toBe('New saved reply');
    expect(unnamedTextControls(host)).toEqual([]);
  });

  it('names the queue edit box after the action and the person', async () => {
    stubEngine({ [ACTIONS.QUEUE_LIST]: { items: [queueItemFixture()] } });
    const host = mountPoint();
    await queue.mount(host);

    expect(host.querySelector('[data-item="q1"]').getAttribute('aria-label')).toBe(
      'Invite text for Ada Lovelace',
    );
    expect(unnamedTextControls(host)).toEqual([]);
  });

  it('names the campaign message editor, its variants and the InMail subject', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    stubEngine({
      [ACTIONS.CAMPAIGN_GET_ALL]: { campaigns: [] },
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
    });
    const host = mountPoint();
    await campaigns.mount(host);

    const stepsHost = host.querySelector('[data-testid="steps"]');
    const addStep = (type) => {
      const adder = [...stepsHost.children].pop().querySelector('select');
      adder.value = type;
      [...stepsHost.children].pop().querySelector('button').click();
    };

    addStep('invite');
    const note = host.querySelector('[data-step="0"] textarea');
    expect(note.getAttribute('aria-label')).toBe('Invite note (200 characters on LinkedIn)');

    [...host.querySelectorAll('[data-step="0"] button')]
      .find((b) => b.textContent.includes('+ Alternative'))
      .click();
    const variant = [...host.querySelectorAll('[data-step="0"] textarea')][1];
    expect(variant.getAttribute('aria-label')).toBe(
      'Invite note (200 characters on LinkedIn) — alternative 1',
    );

    addStep('inmail');
    const subject = host.querySelector('[data-step="1"] input.input');
    expect(subject.getAttribute('aria-label')).toBe('InMail subject');

    expect(unnamedTextControls(host)).toEqual([]);
  });
});
