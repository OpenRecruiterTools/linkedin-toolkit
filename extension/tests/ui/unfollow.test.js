/**
 * @vitest-environment jsdom
 *
 * Mass unfollow card on the Extract tab. The engine only accepts these two
 * actions from the popup, so this card is the only way to reach them — and
 * "Unfollow all" must never fire without an explicit confirmation that says
 * how many people it is about to unfollow.
 */
import { describe, it, expect } from 'vitest';

import * as extract from '../../src/popup/tabs/extract.js';
import { ACTIONS, UNFOLLOW_LIMIT_DEFAULT } from '../../src/lib/actions.js';
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
    expect(cardNode(host).textContent).toContain('There is no undo.');
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
    expect(dialog.textContent).toContain('2–5 second');

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
