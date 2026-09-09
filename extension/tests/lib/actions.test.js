import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  ACTIONS,
  ERROR,
  EVENTS,
  HARD_CAPS,
  DEFAULT_CONFIG,
  INVITE_NOTE_MAX,
  INVITE_NOTE_FIX,
  validateParams,
  clampConfig,
  ok,
  err,
  EngineError,
} from '../../src/lib/actions.js';

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = resolve(here, '../../../docs/actions.md');

/** Parse every action name out of the action-name table in docs/actions.md. */
function actionsFromContract() {
  const md = readFileSync(CONTRACT_PATH, 'utf8');
  const start = md.indexOf('### Action names');
  const end = md.indexOf('### Shared types');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const section = md.slice(start, end);
  const names = new Set();
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    if (line.startsWith('|---') || line.includes('| Action |')) continue;
    const firstCell = line.split('|')[1] || '';
    for (const m of firstCell.matchAll(/`([a-z]+\.[a-zA-Z]+)`/g)) {
      names.add(m[1]);
    }
  }
  return [...names];
}

describe('ACTIONS', () => {
  const contractActions = actionsFromContract();

  it('parses a non-trivial action table out of docs/actions.md', () => {
    expect(contractActions.length).toBeGreaterThan(40);
  });

  it('contains every action string in docs/actions.md', () => {
    const values = new Set(Object.values(ACTIONS));
    const missing = contractActions.filter((a) => !values.has(a));
    expect(missing).toEqual([]);
  });

  it('invents no action that is not in docs/actions.md', () => {
    const contract = new Set(contractActions);
    const extra = Object.values(ACTIONS).filter((a) => !contract.has(a));
    expect(extra).toEqual([]);
  });

  it('uses SCREAMING_SNAKE keys for the dotted action names', () => {
    expect(ACTIONS.SEARCH_PEOPLE).toBe('search.people');
    expect(ACTIONS.NETWORK_UNFOLLOW_COUNT).toBe('network.unfollowCount');
    expect(ACTIONS.LIST_GET_ALL).toBe('list.getAll');
    expect(ACTIONS.LIST_IMPORT_CSV).toBe('list.importCsv');
    expect(ACTIONS.RESEARCH_PACK).toBe('research.pack');
    expect(ACTIONS.SYNC_PULL).toBe('sync.pull');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ACTIONS)).toBe(true);
  });
});

describe('ERROR', () => {
  const CODES = [
    'EXTENSION_OFFLINE',
    'NOT_LOGGED_IN',
    'RATE_LIMITED',
    'CHALLENGE_DETECTED',
    'QUOTA_EXCEEDED',
    'OUTSIDE_BUSINESS_HOURS',
    'INVALID_PARAMS',
    'NOT_FOUND',
    'LINKEDIN_ERROR',
    'AI_NOT_CONFIGURED',
    'AI_ERROR',
    'UNAUTHORIZED',
    'INTERNAL',
  ];

  it('contains every error code in the contract, and no others', () => {
    expect(Object.keys(ERROR).sort()).toEqual([...CODES].sort());
  });

  it('maps each key to its own name', () => {
    for (const code of CODES) expect(ERROR[code]).toBe(code);
  });
});

describe('EVENTS', () => {
  const NAMES = [
    'invite_accepted',
    'reply_received',
    'positive_reply',
    'campaign_step_done',
    'campaign_completed',
    'quota_hit',
    'challenge_detected',
    'queue_item_added',
    'queue_item_sent',
    'campaign_note_truncated',
    'research_progress',
    'research_completed',
  ];

  it('contains every event name in the contract, and no others', () => {
    expect(Object.values(EVENTS).sort()).toEqual([...NAMES].sort());
  });
});

describe('HARD_CAPS', () => {
  it('matches the ceilings in the global constraints', () => {
    expect(HARD_CAPS).toEqual({
      dailyInviteCap: 100,
      dailyMessageCap: 150,
      dailyVisitCap: 500,
      dailySearchCap: 1000,
    });
  });
});

describe('validateParams', () => {
  it('rejects an unknown action', () => {
    expect(validateParams('nope.nope', {})).toEqual({ ok: false, message: 'unknown action' });
  });

  it('rejects search.people with count over 100', () => {
    const res = validateParams('search.people', { keywords: 'x', count: 500 });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/count/);
  });

  it('accepts search.people with a legal count', () => {
    expect(validateParams('search.people', { keywords: 'x', count: 50 })).toEqual({ ok: true });
  });

  it('requires keywords for search.people', () => {
    expect(validateParams('search.people', {}).ok).toBe(false);
  });

  it('rejects a bad enum value', () => {
    expect(validateParams('search.people', { keywords: 'x', source: 'bing' }).ok).toBe(false);
    expect(validateParams('search.people', { keywords: 'x', source: 'salesnav' }).ok).toBe(true);
  });

  it('accepts no-param actions with an empty object or nothing at all', () => {
    expect(validateParams('status.get', {})).toEqual({ ok: true });
    expect(validateParams('config.get')).toEqual({ ok: true });
    expect(validateParams('campaign.tick', {})).toEqual({ ok: true });
    expect(validateParams('network.unfollowCount', {})).toEqual({ ok: true });
  });

  it('holds the mass-unfollow limit between 1 and 5000, or leaves it out', () => {
    // The floor matters as much as the ceiling: `limit: 0` would silently mean
    // "no limit" if it slipped through, which is the opposite of the intent.
    expect(validateParams('network.unfollowAll', {})).toEqual({ ok: true });
    expect(validateParams('network.unfollowAll', { limit: 1, dryRun: true })).toEqual({ ok: true });
    expect(validateParams('network.unfollowAll', { limit: 5000 })).toEqual({ ok: true });

    const low = validateParams('network.unfollowAll', { limit: 0 });
    expect(low.ok).toBe(false);
    expect(low.howToFix).toMatch(/between 1 and 5000/);
    expect(validateParams('network.unfollowAll', { limit: 5001 }).ok).toBe(false);
    expect(validateParams('network.unfollowAll', { limit: '25' }).ok).toBe(false);
    expect(validateParams('network.unfollowAll', { dryRun: 'yes' }).ok).toBe(false);
  });

  it('requires arrays where the contract says arrays', () => {
    expect(validateParams('profile.export', { urls: 'https://x' }).ok).toBe(false);
    expect(validateParams('profile.export', { urls: ['https://x'] }).ok).toBe(true);
    expect(validateParams('network.status', { publicIds: 'a' }).ok).toBe(false);
    expect(validateParams('network.status', { publicIds: ['a'] }).ok).toBe(true);
    expect(validateParams('queue.approve', { ids: ['a'] }).ok).toBe(true);
    expect(validateParams('research.resolve', { rows: [{ name: 'a' }] }).ok).toBe(true);
    expect(validateParams('research.resolve', {}).ok).toBe(false);
  });

  it('accepts either of two alternative identifiers', () => {
    expect(validateParams('profile.get', {}).ok).toBe(false);
    expect(validateParams('profile.get', { publicId: 'dom' }).ok).toBe(true);
    expect(validateParams('profile.get', { url: 'https://x' }).ok).toBe(true);
    expect(validateParams('company.get', { universalName: 'acme' }).ok).toBe(true);
    expect(validateParams('list.add', { listId: 'l1' }).ok).toBe(false);
    expect(validateParams('list.add', { listId: 'l1', publicIds: ['a'] }).ok).toBe(true);
  });

  it('validates outreach write params', () => {
    expect(validateParams('outreach.invite', { publicId: 'dom' }).ok).toBe(true);
    expect(validateParams('outreach.invite', {}).ok).toBe(false);
    expect(validateParams('outreach.message', { publicId: 'dom' }).ok).toBe(false);
    expect(validateParams('outreach.message', { publicId: 'dom', body: 'hi' }).ok).toBe(true);
    expect(validateParams('outreach.inmail', { publicId: 'd', subject: 's', body: 'b' }).ok).toBe(
      true,
    );
    expect(validateParams('outreach.comment', { postUrl: 'u', body: 'b' }).ok).toBe(true);
  });

  describe('the invitation note limit', () => {
    it('is the 200 characters LinkedIn allows', () => {
      expect(INVITE_NOTE_MAX).toBe(200);
      expect(validateParams('outreach.invite', { publicId: 'dom', note: 'x'.repeat(200) }).ok).toBe(
        true,
      );
    });

    it('refuses a longer note, and says how long it was', () => {
      const res = validateParams('outreach.invite', { publicId: 'dom', note: 'x'.repeat(201) });
      expect(res.ok).toBe(false);
      expect(res.message).toContain('201');
      expect(res.howToFix).toBe('LinkedIn limits invitation notes to 200 characters.');
      expect(res.howToFix).toBe(INVITE_NOTE_FIX);
    });

    it('says nothing about a note that is not there', () => {
      expect(validateParams('outreach.invite', { publicId: 'dom' }).ok).toBe(true);
    });

    it('leaves messages alone — only invitations have this limit', () => {
      expect(
        validateParams('outreach.message', { publicId: 'dom', body: 'x'.repeat(2000) }).ok,
      ).toBe(true);
    });
  });

  it('carries no howToFix for a refusal that has no specific advice', () => {
    expect(validateParams('outreach.invite', {}).howToFix).toBeUndefined();
  });

  it('accepts every status the queue can actually be in', () => {
    for (const status of ['pending', 'approved', 'rejected', 'sent', 'failed']) {
      expect(validateParams('queue.list', { status }).ok, status).toBe(true);
    }
    expect(validateParams('queue.list', { status: 'gone' }).ok).toBe(false);
  });

  it('has a spec for every action in ACTIONS', () => {
    for (const action of Object.values(ACTIONS)) {
      const res = validateParams(action, {});
      expect(res.message === 'unknown action', `${action} has no validator`).toBe(false);
    }
  });
});

describe('clampConfig', () => {
  it('fills in the documented defaults', () => {
    const cfg = clampConfig({});
    expect(cfg.minDelayMs).toBe(8000);
    expect(cfg.maxDelayMs).toBe(15000);
    expect(cfg.hourlyCap).toBe(20);
    expect(cfg.dailyInviteCap).toBe(25);
    expect(cfg.dailyMessageCap).toBe(50);
    expect(cfg.dailyVisitCap).toBe(100);
    expect(cfg.dailySearchCap).toBe(500);
    expect(cfg.businessHoursOnly).toBe(true);
    expect(cfg.businessStart).toBe(9);
    expect(cfg.businessEnd).toBe(18);
    expect(cfg.weekdaysOnly).toBe(true);
    expect(cfg.autopilot).toBe(false);
    expect(cfg.accountPreset).toBe('free');
    expect(cfg.warmup).toEqual({ enabled: false, days: 14 });
    expect(cfg.ai).toEqual({ provider: 'none' });
    expect(cfg.bridge).toEqual({ enabled: false, port: 47829 });
  });

  it('clamps daily caps to the hard ceilings', () => {
    expect(clampConfig({ dailyInviteCap: 999 }).dailyInviteCap).toBe(100);
    expect(clampConfig({ dailyMessageCap: 9999 }).dailyMessageCap).toBe(150);
    expect(clampConfig({ dailyVisitCap: 9999 }).dailyVisitCap).toBe(500);
    expect(clampConfig({ dailySearchCap: 99999 }).dailySearchCap).toBe(1000);
    expect(clampConfig({ hourlyCap: 500 }).hourlyCap).toBe(50);
  });

  it('enforces the delay floor and ordering', () => {
    expect(clampConfig({ minDelayMs: 10 }).minDelayMs).toBe(3000);
    const cfg = clampConfig({ minDelayMs: 20000, maxDelayMs: 5000 });
    expect(cfg.maxDelayMs).toBeGreaterThanOrEqual(cfg.minDelayMs);
  });

  it('coerces numeric strings', () => {
    const cfg = clampConfig({ dailyInviteCap: '30', businessStart: '7' });
    expect(cfg.dailyInviteCap).toBe(30);
    expect(cfg.businessStart).toBe(7);
  });

  it('ignores an unknown accountPreset and keeps a valid one', () => {
    expect(clampConfig({ accountPreset: 'wat' }).accountPreset).toBe('free');
    expect(clampConfig({ accountPreset: 'salesnav' }).accountPreset).toBe('salesnav');
  });

  it('does not mutate DEFAULT_CONFIG', () => {
    const cfg = clampConfig({ dailyInviteCap: 99, ai: { provider: 'ollama' } });
    expect(cfg.dailyInviteCap).toBe(99);
    expect(DEFAULT_CONFIG.dailyInviteCap).toBe(25);
    expect(DEFAULT_CONFIG.ai.provider).toBe('none');
  });

  it('merges nested config objects one level deep', () => {
    const cfg = clampConfig({ bridge: { enabled: true } });
    expect(cfg.bridge).toEqual({ enabled: true, port: 47829 });
  });
});

describe('envelopes', () => {
  it('ok() builds a success envelope', () => {
    expect(ok('1', { a: 1 })).toEqual({ id: '1', ok: true, data: { a: 1 } });
  });

  it('ok() attaches rateLimit only when given', () => {
    const rl = { hourlyUsed: 1, hourlyCap: 20, dailyUsed: 1, dailyCap: 25, nextAllowedAt: 0 };
    expect(ok('1', {}, rl).rateLimit).toEqual(rl);
    expect('rateLimit' in ok('1', {})).toBe(false);
  });

  it('err() builds an error envelope', () => {
    expect(err('2', ERROR.INVALID_PARAMS, 'bad')).toEqual({
      id: '2',
      ok: false,
      error: { code: 'INVALID_PARAMS', message: 'bad' },
    });
  });

  it('err() folds extra fields into error', () => {
    const e = err('2', ERROR.RATE_LIMITED, 'slow down', { retryAfter: 60, howToFix: 'wait' });
    expect(e.error).toEqual({
      code: 'RATE_LIMITED',
      message: 'slow down',
      retryAfter: 60,
      howToFix: 'wait',
    });
  });
});

describe('EngineError', () => {
  it('carries code, message and extra', () => {
    const e = new EngineError(ERROR.QUOTA_EXCEEDED, 'nope', { retryAfter: 30 });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('EngineError');
    expect(e.code).toBe('QUOTA_EXCEEDED');
    expect(e.message).toBe('nope');
    expect(e.extra).toEqual({ retryAfter: 30 });
  });

  it('defaults extra to an empty object', () => {
    expect(new EngineError(ERROR.INTERNAL, 'boom').extra).toEqual({});
  });
});
