/**
 * @vitest-environment jsdom
 *
 * Mass unfollow card on the Extract tab. The engine only accepts these two
 * actions from the popup, so this card is the only way to reach them — and
 * "Unfollow all" must never fire without an explicit confirmation.
 */
import { describe, it, expect } from 'vitest';

import * as extract from '../../src/popup/tabs/extract.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint } from './helpers.js';

const cardNode = (host) => host.querySelector('.extract-unfollow');
const buttonNamed = (host, label) =>
  [...cardNode(host).querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label));
const dialogButton = (testid) => document.querySelector(`[data-testid="${testid}"]`);

describe('Mass unfollow card', () => {
  it('names both buttons for a screen reader', async () => {
    stubEngine({ [ACTIONS.LIST_GET_ALL]: { lists: [] } });
    const host = mountPoint();
    await extract.mount(host);

    expect(buttonNamed(host, 'Check count').getAttribute('aria-label')).toBe(
      'Check how many accounts you follow',
    );
    expect(buttonNamed(host, 'Unfollow all').getAttribute('aria-label')).toBe(
      'Unfollow everyone you follow',
    );
    expect(cardNode(host).textContent).toContain('There is no undo.');
  });

  it('renders the count from network.unfollowCount', async () => {
    const engine = stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.NETWORK_UNFOLLOW_COUNT]: { count: 412 },
    });
    const host = mountPoint();
    await extract.mount(host);

    buttonNamed(host, 'Check count').click();
    await flush(8);

    expect(engine.paramsFor(ACTIONS.NETWORK_UNFOLLOW_COUNT)).toEqual({});
    expect(cardNode(host).textContent).toContain('412 accounts you can unfollow.');
  });

  it('asks before unfollowing and does nothing when cancelled', async () => {
    const engine = stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: { unfollowed: 9, errors: 0 },
    });
    const host = mountPoint();
    await extract.mount(host);

    buttonNamed(host, 'Unfollow all').click();
    await flush(6);

    const dialog = document.querySelector('[data-testid="confirm-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('2–5 second');

    dialogButton('confirm-cancel').click();
    await flush(6);

    expect(engine.countOf(ACTIONS.NETWORK_UNFOLLOW_ALL)).toBe(0);
    expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
    expect(cardNode(host).textContent).toContain('Cancelled');
  });

  it('runs network.unfollowAll on confirm and reports the count', async () => {
    const engine = stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: { unfollowed: 137, errors: 0 },
    });
    const host = mountPoint();
    await extract.mount(host);

    buttonNamed(host, 'Unfollow all').click();
    await flush(6);
    dialogButton('confirm-ok').click();
    await flush(10);

    expect(engine.countOf(ACTIONS.NETWORK_UNFOLLOW_ALL)).toBe(1);
    expect(engine.paramsFor(ACTIONS.NETWORK_UNFOLLOW_ALL)).toEqual({});
    expect(cardNode(host).textContent).toContain('Unfollowed 137 accounts.');
  });

  it('shows an engine refusal inline instead of throwing', async () => {
    stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.NETWORK_UNFOLLOW_ALL]: {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Mass unfollow runs in your own browser tab' },
      },
    });
    const host = mountPoint();
    await extract.mount(host);

    buttonNamed(host, 'Unfollow all').click();
    await flush(6);
    dialogButton('confirm-ok').click();
    await flush(10);

    const err = cardNode(host).querySelector('.err');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('UNAUTHORIZED');
  });
});
