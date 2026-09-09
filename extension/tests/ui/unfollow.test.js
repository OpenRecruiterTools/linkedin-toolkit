/**
 * @vitest-environment jsdom
 *
 * Mass unfollow card on the Extract tab. The engine only accepts these two
 * actions from the popup, so this card is the only way to reach them — and
 * "Unfollow all" must never fire without an explicit confirmation that says
 * how many people it is about to unfollow.
 */
import { describe, it, expect, vi } from 'vitest';

import * as extract from '../../src/popup/tabs/extract.js';
import {
  ACTIONS,
  EVENTS,
  UNFOLLOW_LIMIT_DEFAULT,
  UNFOLLOW_MODE_DEFAULT,
} from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint } from './helpers.js';

const cardNode = (host) => host.querySelector('.extract-unfollow');
const buttonNamed = (host, label) =>
  [...cardNode(host).querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label));
const dialogButton = (testid) => document.querySelector(`[data-testid="${testid}"]`);
const limitBox = (host) => cardNode(host).querySelector('[data-testid="unfollow-limit"]');
const nameItems = (host) =>
  [...cardNode(host).querySelectorAll('[data-testid="unfollow-names"] li')].map((li) =>
    li.textContent.trim(),
  );

/** Mount the tab with the given engine stubs and hand back the host. */
async function mount(handlers = {}) {
  const engine = stubEngine({ [ACTIONS.LIST_GET_ALL]: { lists: [] }, ...handlers });
  const host = mountPoint();
  await extract.mount(host);
  return { engine, host };
}

describe('Mass unfollow card', () => {
  it('names every control for a screen reader', async () => {
    const { host } = await mount();

    expect(buttonNamed(host, 'Check count').getAttribute('aria-label')).toBe(
      'Check how many accounts you follow',
    );
    expect(buttonNamed(host, 'Preview').getAttribute('aria-label')).toBe(
      'Preview who would be unfollowed, without unfollowing anyone',
    );
    expect(buttonNamed(host, 'Unfollow all').getAttribute('aria-label')).toBe(
      'Unfollow everyone you follow',
    );
    expect(limitBox(host).getAttribute('aria-label')).toBe('Unfollow up to how many accounts');
    expect(cardNode(host).textContent).toContain('there is no undo');
  });

  it('starts at a small number rather than at everyone', async () => {
    const { host } = await mount();

    expect(limitBox(host).value).toBe(String(UNFOLLOW_LIMIT_DEFAULT));
    expect(limitBox(host).getAttribute('type')).toBe('number');
    expect(cardNode(host).textContent).toContain('Leave empty to work through everyone.');
  });

  it('renders the count and the sample from network.unfollowCount', async () => {
    const { engine, host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_COUNT]: {
        count: 412,
        sample: ['Ada Lovelace', 'Grace Hopper'],
      },
    });

    buttonNamed(host, 'Check count').click();
    await flush(8);

    expect(engine.paramsFor(ACTIONS.NETWORK_UNFOLLOW_COUNT)).toEqual({});
    expect(cardNode(host).textContent).toContain('412 accounts you can unfollow.');
    expect(nameItems(host)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });
});

describe('Preview', () => {
  it('runs a dry run at the chosen limit and lists the names', async () => {
    const { engine, host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: {
        unfollowed: 0,
        attempted: 0,
        names: ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'],
        stopped: 'limit',
      },
    });

    limitBox(host).value = '3';
    buttonNamed(host, 'Preview').click();
    await flush(10);

    expect(engine.paramsFor(ACTIONS.NETWORK_UNFOLLOW_ALL)).toEqual({ limit: 3, dryRun: true });
    expect(nameItems(host)).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
    expect(cardNode(host).textContent).toContain('nothing was unfollowed');
  });

  it('previews the whole list when the box is cleared', async () => {
    const { engine, host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: { unfollowed: 0, attempted: 0, names: [], stopped: 'end' },
    });

    limitBox(host).value = '';
    buttonNamed(host, 'Preview').click();
    await flush(10);

    expect(engine.paramsFor(ACTIONS.NETWORK_UNFOLLOW_ALL)).toEqual({ dryRun: true });
    expect(cardNode(host).textContent).toContain('found nobody to unfollow');
  });

  it('never asks the engine for a nonsense limit', async () => {
    const { engine, host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: { unfollowed: 0, attempted: 0, names: [] },
    });

    limitBox(host).value = '0';
    buttonNamed(host, 'Preview').click();
    await flush(8);

    expect(engine.countOf(ACTIONS.NETWORK_UNFOLLOW_ALL)).toBe(0);
    expect(cardNode(host).querySelector('.err').hidden).toBe(false);
  });
});

describe('Unfollow all', () => {
  it('says the number out loud before it does anything', async () => {
    const { engine, host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: { unfollowed: 9, attempted: 9, names: [] },
    });

    limitBox(host).value = '5';
    buttonNamed(host, 'Unfollow all').click();
    await flush(6);

    const dialog = document.querySelector('[data-testid="confirm-dialog"]');
    expect(dialog.textContent).toContain('Unfollow up to 5?');
    expect(dialog.textContent).toContain('This will unfollow 5 accounts.');
    expect(dialog.textContent).toContain('there is no undo');

    dialogButton('confirm-cancel').click();
    await flush(6);

    expect(engine.countOf(ACTIONS.NETWORK_UNFOLLOW_ALL)).toBe(0);
    expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
    expect(cardNode(host).textContent).toContain('Cancelled');
  });

  it('warns about everyone when no limit is set', async () => {
    const { host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: { unfollowed: 0, attempted: 0, names: [] },
    });

    limitBox(host).value = '';
    buttonNamed(host, 'Unfollow all').click();
    await flush(6);

    const dialog = document.querySelector('[data-testid="confirm-dialog"]');
    expect(dialog.textContent).toContain('Unfollow everyone?');
    expect(dialog.textContent).toContain('This will unfollow everyone you follow.');
  });

  it('sends the limit, reports the count and lists who went', async () => {
    const { engine, host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: {
        unfollowed: 2,
        attempted: 2,
        names: ['Ada Lovelace', 'Grace Hopper'],
        stopped: 'limit',
      },
    });

    limitBox(host).value = '2';
    buttonNamed(host, 'Unfollow all').click();
    await flush(6);
    dialogButton('confirm-ok').click();
    await flush(10);

    expect(engine.countOf(ACTIONS.NETWORK_UNFOLLOW_ALL)).toBe(1);
    expect(engine.paramsFor(ACTIONS.NETWORK_UNFOLLOW_ALL)).toEqual({ limit: 2 });
    expect(cardNode(host).textContent).toContain('Unfollowed 2 accounts.');
    expect(cardNode(host).textContent).toContain('Stopped at your limit.');
    expect(nameItems(host)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('says why a run ended early instead of pretending it finished', async () => {
    const { host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: {
        unfollowed: 4,
        attempted: 5,
        names: ['Ada Lovelace'],
        stopped: 'error',
        error: 'The tab moved away from your Following list — stopped there.',
      },
    });

    buttonNamed(host, 'Unfollow all').click();
    await flush(6);
    dialogButton('confirm-ok').click();
    await flush(10);

    expect(cardNode(host).textContent).toContain('Unfollowed 4 accounts.');
    expect(cardNode(host).textContent).toContain('Stopped early: The tab moved away');
  });

  it('shows an engine refusal inline instead of throwing', async () => {
    const { host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Mass unfollow runs in your own browser tab' },
      },
    });

    buttonNamed(host, 'Unfollow all').click();
    await flush(6);
    dialogButton('confirm-ok').click();
    await flush(10);

    const err = cardNode(host).querySelector('.err');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('UNAUTHORIZED');
  });
});

/* ================================================================== */
/*  Mode, progress and Stop                                            */
/* ================================================================== */

const progressNode = (host) => cardNode(host).querySelector('[data-testid="unfollow-progress"]');
const modeBox = (host) => cardNode(host).querySelector('[data-testid="unfollow-mode"]');
const stopBtn = (host) => cardNode(host).querySelector('[data-testid="unfollow-stop"]');

/** Deliver one engine event to whatever the popup has subscribed. */
function emitEvent(event, payload) {
  for (const listener of chrome.__mock.listeners.onMessage) {
    listener({ type: 'EVENT', event, payload }, {}, () => {});
  }
}

describe('Mode', () => {
  it('hides the choice behind Advanced and defaults to the fast one', async () => {
    const { host } = await mount();

    const advanced = cardNode(host).querySelector('[data-testid="unfollow-advanced"]');
    expect(advanced.tagName).toBe('DETAILS');
    expect(advanced.open).toBe(false);
    expect(advanced.querySelector('summary').textContent).toBe('Advanced');
    expect(advanced.contains(modeBox(host))).toBe(true);

    expect(modeBox(host).value).toBe(UNFOLLOW_MODE_DEFAULT);
    expect(modeBox(host).getAttribute('aria-label')).toBe('How to unfollow');
  });

  it('says nothing about the mode when it is the default one', async () => {
    const { engine, host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: { unfollowed: 0, attempted: 0, names: [], stopped: 'end' },
      [ACTIONS.NETWORK_UNFOLLOW_COUNT]: { count: 3, sample: [] },
    });

    buttonNamed(host, 'Check count').click();
    await flush(8);
    limitBox(host).value = '2';
    buttonNamed(host, 'Preview').click();
    await flush(8);

    expect(engine.paramsFor(ACTIONS.NETWORK_UNFOLLOW_COUNT)).toEqual({});
    expect(engine.paramsFor(ACTIONS.NETWORK_UNFOLLOW_ALL)).toEqual({ limit: 2, dryRun: true });
  });

  it('carries the slow mode through to the engine when it is chosen', async () => {
    const { engine, host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: { unfollowed: 0, attempted: 0, names: [], stopped: 'end' },
      [ACTIONS.NETWORK_UNFOLLOW_COUNT]: { count: 3, sample: [] },
    });

    modeBox(host).value = 'dom';
    buttonNamed(host, 'Check count').click();
    await flush(8);
    limitBox(host).value = '2';
    buttonNamed(host, 'Preview').click();
    await flush(8);

    expect(engine.paramsFor(ACTIONS.NETWORK_UNFOLLOW_COUNT)).toEqual({ mode: 'dom' });
    expect(engine.paramsFor(ACTIONS.NETWORK_UNFOLLOW_ALL)).toEqual({
      limit: 2,
      dryRun: true,
      mode: 'dom',
    });
  });
});

describe('Progress', () => {
  it('is silent until a run starts', async () => {
    const { host } = await mount();
    expect(progressNode(host).hidden).toBe(true);
  });

  it('counts up from the unfollow_progress event', async () => {
    const { host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: () =>
        new Promise(() => {}), // never settles: the run is still going
      [ACTIONS.NETWORK_UNFOLLOW_STATUS]: { running: true, done: 0, total: 0, lastName: '' },
    });

    limitBox(host).value = '50';
    buttonNamed(host, 'Unfollow all').click();
    await flush(6);
    dialogButton('confirm-ok').click();
    await flush(6);

    emitEvent(EVENTS.UNFOLLOW_PROGRESS, { done: 10, total: 735 });
    await flush(2);

    expect(progressNode(host).hidden).toBe(false);
    expect(progressNode(host).textContent).toBe('Unfollowed 10 of 735');
    // A live region, so a screen reader hears the run move.
    expect(progressNode(host).getAttribute('aria-live')).toBe('polite');
  });

  it('fills in the ten between events by polling unfollowStatus', async () => {
    vi.useFakeTimers();
    try {
      const { engine, host } = await mount({
        [ACTIONS.NETWORK_UNFOLLOW_ALL]: () => new Promise(() => {}),
        [ACTIONS.NETWORK_UNFOLLOW_STATUS]: {
          running: true,
          done: 4,
          total: 735,
          lastName: 'Marlow Ashcombe',
        },
      });

      limitBox(host).value = '50';
      buttonNamed(host, 'Unfollow all').click();
      await vi.advanceTimersByTimeAsync(5);
      dialogButton('confirm-ok').click();
      await vi.advanceTimersByTimeAsync(5);

      await vi.advanceTimersByTimeAsync(extract.UNFOLLOW_POLL_MS + 5);

      expect(engine.countOf(ACTIONS.NETWORK_UNFOLLOW_STATUS)).toBeGreaterThan(0);
      expect(progressNode(host).textContent).toBe(
        'Unfollowed 4 of 735 — last: Marlow Ashcombe',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Stop', () => {
  it('is disabled until there is something to stop', async () => {
    const { host } = await mount();
    expect(stopBtn(host).disabled).toBe(true);
    expect(stopBtn(host).getAttribute('aria-label')).toBe('Stop the unfollow run');
  });

  it('asks the engine to stop, and the run reports it as cancelled', async () => {
    let finish;
    const { engine, host } = await mount({
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      [ACTIONS.NETWORK_UNFOLLOW_STATUS]: { running: true, done: 2, total: 735, lastName: '' },
      [ACTIONS.NETWORK_UNFOLLOW_STOP]: { stopping: true },
    });

    limitBox(host).value = '50';
    buttonNamed(host, 'Unfollow all').click();
    await flush(6);
    dialogButton('confirm-ok').click();
    await flush(6);

    expect(stopBtn(host).disabled).toBe(false);
    stopBtn(host).click();
    await flush(6);

    expect(engine.countOf(ACTIONS.NETWORK_UNFOLLOW_STOP)).toBe(1);
    expect(cardNode(host).textContent).toContain('Stopping after the person in flight');

    finish({
      unfollowed: 2,
      attempted: 2,
      names: ['Marlow Ashcombe', 'Perrin Oyelaran'],
      stopped: 'cancelled',
    });
    await flush(10);

    expect(cardNode(host).textContent).toContain('Unfollowed 2 accounts.');
    expect(cardNode(host).textContent).toContain('Stopped at your request.');
    expect(nameItems(host)).toEqual(['Marlow Ashcombe', 'Perrin Oyelaran']);
    expect(stopBtn(host).disabled).toBe(true);
  });

  it('stops polling when the tab is left, so a closed popup leaves no timer', async () => {
    vi.useFakeTimers();
    try {
      const { engine, host } = await mount({
        [ACTIONS.NETWORK_UNFOLLOW_ALL]: () => new Promise(() => {}),
        [ACTIONS.NETWORK_UNFOLLOW_STATUS]: { running: true, done: 1, total: 5, lastName: '' },
      });

      buttonNamed(host, 'Unfollow all').click();
      await vi.advanceTimersByTimeAsync(5);
      dialogButton('confirm-ok').click();
      await vi.advanceTimersByTimeAsync(extract.UNFOLLOW_POLL_MS + 5);
      const polled = engine.countOf(ACTIONS.NETWORK_UNFOLLOW_STATUS);
      expect(polled).toBeGreaterThan(0);

      extract.unmount();
      await vi.advanceTimersByTimeAsync(extract.UNFOLLOW_POLL_MS * 3);

      expect(engine.countOf(ACTIONS.NETWORK_UNFOLLOW_STATUS)).toBe(polled);
    } finally {
      vi.useRealTimers();
    }
  });
});
