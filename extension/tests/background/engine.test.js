import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ACTIONS, ERROR } from '../../src/lib/actions.js';
import {
  handle,
  register,
  setRateLimitProvider,
  resetEngine,
  EngineError,
} from '../../src/background/engine.js';

const RATE_LIMIT = {
  hourlyUsed: 3,
  hourlyCap: 20,
  dailyUsed: 7,
  dailyCap: 25,
  nextAllowedAt: 0,
};

beforeEach(() => {
  resetEngine();
});

describe('handle', () => {
  it('rejects an unknown action with INVALID_PARAMS', async () => {
    const res = await handle('nope');
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.INVALID_PARAMS);
    expect(res.error.message).toBe('unknown action');
  });

  it('rejects bad params for a known action with INVALID_PARAMS', async () => {
    register(ACTIONS.SEARCH_PEOPLE, async () => ({ profiles: [] }));
    const res = await handle(ACTIONS.SEARCH_PEOPLE, { keywords: 'x', count: 500 });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.INVALID_PARAMS);
  });

  it('carries the validator\'s howToFix onto the error envelope', async () => {
    register(ACTIONS.OUTREACH_INVITE, async () => ({}));
    const res = await handle(ACTIONS.OUTREACH_INVITE, {
      publicId: 'dom',
      note: 'x'.repeat(201),
    });
    expect(res.ok).toBe(false);
    expect(res.error.howToFix).toBe('LinkedIn limits invitation notes to 200 characters.');
  });

  it('leaves howToFix off a refusal that carries no advice', async () => {
    register(ACTIONS.SEARCH_PEOPLE, async () => ({ profiles: [] }));
    const res = await handle(ACTIONS.SEARCH_PEOPLE, {});
    expect(res.error.howToFix).toBeUndefined();
  });

  it('validates before the handler runs', async () => {
    const fn = vi.fn(async () => ({}));
    register(ACTIONS.SEARCH_PEOPLE, fn);
    await handle(ACTIONS.SEARCH_PEOPLE, {});
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a contract action with no handler registered', async () => {
    const res = await handle(ACTIONS.INBOX_EXPORT, {});
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.NOT_FOUND);
  });

  it('wraps a registered handler result in a success envelope', async () => {
    register(ACTIONS.STATUS_GET, async () => ({ connected: true }));
    const res = await handle(ACTIONS.STATUS_GET);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ connected: true });
    expect(typeof res.id).toBe('string');
    expect('rateLimit' in res).toBe(false);
  });

  it('passes params and ctx.origin to the handler', async () => {
    const fn = vi.fn(async () => ({}));
    register(ACTIONS.LIST_GET, fn);
    await handle(ACTIONS.LIST_GET, { listId: 'l1' }, 'mcp');
    expect(fn).toHaveBeenCalledWith({ listId: 'l1' }, { origin: 'mcp' });
  });

  it("defaults origin to 'popup'", async () => {
    const fn = vi.fn(async () => ({}));
    register(ACTIONS.LIST_GET_ALL, fn);
    await handle(ACTIONS.LIST_GET_ALL);
    expect(fn.mock.calls[0][1]).toEqual({ origin: 'popup' });
  });

  it('accepts a synchronous handler', async () => {
    register(ACTIONS.CONFIG_GET, () => ({ autopilot: false }));
    const res = await handle(ACTIONS.CONFIG_GET);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ autopilot: false });
  });

  it('maps a thrown EngineError onto the error envelope', async () => {
    register(ACTIONS.OUTREACH_INVITE, async () => {
      throw new EngineError(ERROR.QUOTA_EXCEEDED, 'x');
    });
    const res = await handle(ACTIONS.OUTREACH_INVITE, { publicId: 'dom' });
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'QUOTA_EXCEEDED', message: 'x' },
    });
  });

  it('folds EngineError extra fields into the error', async () => {
    register(ACTIONS.OUTREACH_MESSAGE, async () => {
      throw new EngineError(ERROR.RATE_LIMITED, 'slow', { retryAfter: 60, howToFix: 'wait' });
    });
    const res = await handle(ACTIONS.OUTREACH_MESSAGE, { publicId: 'd', body: 'b' });
    expect(res.error).toEqual({
      code: 'RATE_LIMITED',
      message: 'slow',
      retryAfter: 60,
      howToFix: 'wait',
    });
  });

  it('wraps an unknown throw as INTERNAL', async () => {
    register(ACTIONS.CAMPAIGN_TICK, async () => {
      throw new TypeError('boom');
    });
    const res = await handle(ACTIONS.CAMPAIGN_TICK);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.INTERNAL);
    expect(res.error.message).toBe('boom');
  });
});

describe('register', () => {
  it('refuses an action that is not in the contract', () => {
    expect(() => register('made.up', () => {})).toThrow(/made\.up/);
  });

  it('refuses a non-function handler', () => {
    expect(() => register(ACTIONS.STATUS_GET, 'nope')).toThrow();
  });

  it('lets a later registration replace an earlier one', async () => {
    register(ACTIONS.STATUS_GET, async () => ({ v: 1 }));
    register(ACTIONS.STATUS_GET, async () => ({ v: 2 }));
    expect((await handle(ACTIONS.STATUS_GET)).data).toEqual({ v: 2 });
  });
});

describe('rateLimit', () => {
  it('attaches rateLimit to outreach actions when a provider is set', async () => {
    const provider = vi.fn(() => RATE_LIMIT);
    setRateLimitProvider(provider);
    register(ACTIONS.OUTREACH_INVITE, async () => ({ status: 'sent' }));

    const res = await handle(ACTIONS.OUTREACH_INVITE, { publicId: 'dom' });
    expect(res.ok).toBe(true);
    expect(res.rateLimit).toEqual(RATE_LIMIT);
    expect(provider).toHaveBeenCalledWith('invite');
  });

  it('asks the provider for the quota kind that matches the action', async () => {
    const provider = vi.fn(() => RATE_LIMIT);
    setRateLimitProvider(provider);
    register(ACTIONS.OUTREACH_INMAIL, async () => ({ status: 'sent' }));
    register(ACTIONS.OUTREACH_VIEW, async () => ({ status: 'sent' }));

    await handle(ACTIONS.OUTREACH_INMAIL, { publicId: 'd', subject: 's', body: 'b' });
    expect(provider).toHaveBeenLastCalledWith('message');

    await handle(ACTIONS.OUTREACH_VIEW, { publicId: 'd' });
    expect(provider).toHaveBeenLastCalledWith('visit');
  });

  it('awaits an async provider', async () => {
    setRateLimitProvider(async () => RATE_LIMIT);
    register(ACTIONS.OUTREACH_FOLLOW, async () => ({ status: 'sent' }));
    const res = await handle(ACTIONS.OUTREACH_FOLLOW, { publicId: 'dom' });
    expect(res.rateLimit).toEqual(RATE_LIMIT);
  });

  it('omits rateLimit when no provider is set', async () => {
    register(ACTIONS.OUTREACH_INVITE, async () => ({ status: 'sent' }));
    const res = await handle(ACTIONS.OUTREACH_INVITE, { publicId: 'dom' });
    expect('rateLimit' in res).toBe(false);
  });

  it('never attaches rateLimit to non-outreach actions', async () => {
    setRateLimitProvider(() => RATE_LIMIT);
    register(ACTIONS.SEARCH_PEOPLE, async () => ({ profiles: [] }));
    const res = await handle(ACTIONS.SEARCH_PEOPLE, { keywords: 'x' });
    expect('rateLimit' in res).toBe(false);
  });

  it('does not fail the call when the provider throws', async () => {
    setRateLimitProvider(() => {
      throw new Error('quota module not ready');
    });
    register(ACTIONS.OUTREACH_LIKE, async () => ({ status: 'sent' }));
    const res = await handle(ACTIONS.OUTREACH_LIKE, { postUrl: 'https://x' });
    expect(res.ok).toBe(true);
    expect('rateLimit' in res).toBe(false);
  });
});
