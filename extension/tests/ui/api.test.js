/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import { send, call, ApiError, getLocal, setLocal, UI_KEYS } from '../../src/ui/api.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine } from './helpers.js';

describe('send', () => {
  it('posts { action, params } and returns the envelope', async () => {
    const engine = stubEngine({ [ACTIONS.STATUS_GET]: { loggedIn: true } });

    const envelope = await send(ACTIONS.STATUS_GET, { a: 1 });

    expect(engine.calls[0]).toEqual({ action: ACTIONS.STATUS_GET, params: { a: 1 } });
    expect(envelope).toEqual({ ok: true, data: { loggedIn: true } });
  });

  it('never sends the old v1 type strings', async () => {
    const engine = stubEngine({ [ACTIONS.CONFIG_GET]: {} });
    await send(ACTIONS.CONFIG_GET);
    expect(engine.calls[0].type).toBeUndefined();
  });

  it('normalizes an error envelope', async () => {
    stubEngine({
      [ACTIONS.OUTREACH_INVITE]: {
        ok: false,
        error: { code: 'QUOTA_EXCEEDED', message: 'daily cap', howToFix: 'wait' },
      },
    });
    const envelope = await send(ACTIONS.OUTREACH_INVITE, { publicId: 'ada' });
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toEqual({
      code: 'QUOTA_EXCEEDED',
      message: 'daily cap',
      howToFix: 'wait',
      retryAfter: undefined,
    });
  });

  it('turns a dead service worker into EXTENSION_OFFLINE', async () => {
    chrome.runtime.sendMessage = (_msg, cb) => cb(undefined);
    const envelope = await send(ACTIONS.STATUS_GET);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('EXTENSION_OFFLINE');
  });

  it('does not reject when sendMessage throws', async () => {
    chrome.runtime.sendMessage = () => {
      throw new Error('Extension context invalidated.');
    };
    const envelope = await send(ACTIONS.STATUS_GET);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('EXTENSION_OFFLINE');
    expect(envelope.error.message).toMatch(/invalidated/);
  });
});

describe('call', () => {
  it('unwraps data on success', async () => {
    stubEngine({ [ACTIONS.LIST_GET_ALL]: { lists: [] } });
    expect(await call(ACTIONS.LIST_GET_ALL)).toEqual({ lists: [] });
  });

  it('throws an ApiError carrying the code and howToFix', async () => {
    stubEngine({
      [ACTIONS.SEARCH_PEOPLE]: {
        ok: false,
        error: { code: 'NOT_LOGGED_IN', message: 'sign in', howToFix: 'open linkedin.com' },
      },
    });

    await expect(call(ACTIONS.SEARCH_PEOPLE, { keywords: 'cto' })).rejects.toBeInstanceOf(ApiError);

    try {
      await call(ACTIONS.SEARCH_PEOPLE, { keywords: 'cto' });
    } catch (e) {
      expect(e.code).toBe('NOT_LOGGED_IN');
      expect(e.display).toBe('NOT_LOGGED_IN: sign in — open linkedin.com');
    }
  });
});

describe('local UI state', () => {
  it('round-trips through chrome.storage.local', async () => {
    expect(await getLocal(UI_KEYS.ACTIVE_TAB, 'dashboard')).toBe('dashboard');
    await setLocal(UI_KEYS.ACTIVE_TAB, 'queue');
    expect(await getLocal(UI_KEYS.ACTIVE_TAB, 'dashboard')).toBe('queue');
  });
});
