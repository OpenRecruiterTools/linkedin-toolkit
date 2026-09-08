import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS, ERROR, HARD_CAPS } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { getConfig } from '../../src/lib/config.js';
import * as bridge from '../../src/background/bridge.js';
import * as inbox from '../../src/background/inbox.js';
import * as quota from '../../src/background/quota.js';
import * as storage from '../../src/lib/storage.js';
import '../../src/background/status.js';
import '../../src/background/sync.js';
import '../../src/background/outreach.js';
import '../../src/background/lists.js';
import { seedSession, stubFetch } from '../helpers/net.js';

import conversations from '../fixtures/voyager/conversations.json';

const NOW = new Date(2026, 8, 9, 11, 0, 0);

let net;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  quota.setSleepFn(() => Promise.resolve());
  bridge.disconnect();
  net = stubFetch();
});

afterEach(() => {
  bridge.disconnect();
  vi.useRealTimers();
});

const ada = {
  publicId: 'adalovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  fullName: 'Ada Lovelace',
  headline: 'Chief Analyst at Analytical Engines',
  title: 'Chief Analyst',
  company: 'Analytical Engines',
  location: 'London, United Kingdom',
  url: 'https://www.linkedin.com/in/adalovelace/',
  skills: ['Maths', 'Algorithms'],
};

/* ================================================================== */
/*  status.get                                                        */
/* ================================================================== */

describe('status.get', () => {
  it('returns the whole contract Status', async () => {
    const res = await handle(ACTIONS.STATUS_GET, {});
    expect(res.ok).toBe(true);

    const s = res.data;
    expect(s.connected).toBe(true);
    expect(s.extensionVersion).toBe('2.0.0');
    expect(s.loggedIn).toBe(false);
    expect(s.autopilot).toBe(false);
    expect(typeof s.businessHours).toBe('boolean');
    expect(Object.keys(s.quotas).sort()).toEqual(['invite', 'message', 'search', 'visit']);
    expect(s.quotas.invite).toMatchObject({ dailyUsed: 0, dailyCap: 20 });
    expect(s.queue).toEqual({ pending: 0 });
    expect(s.campaigns).toEqual({ active: 0, paused: 0 });
    expect(s.bridge).toEqual({ enabled: false, connected: false, port: 47829 });
    expect(s.backoffUntil).toBeUndefined();
    expect(s.challenge).toBeUndefined();
  });

  it('reports loggedIn from the session cookie', async () => {
    seedSession();
    expect((await handle(ACTIONS.STATUS_GET, {})).data.loggedIn).toBe(true);
  });

  it('reports a live backoff and a live challenge', async () => {
    await quota.noteBackoff(429);
    let s = (await handle(ACTIONS.STATUS_GET, {})).data;
    expect(s.backoffUntil).toBeGreaterThan(Date.now());
    expect(s.challenge).toBeUndefined();

    await quota.noteBackoff(451);
    s = (await handle(ACTIONS.STATUS_GET, {})).data;
    expect(s.challenge.detectedAt).toBeTruthy();
  });

  it('counts what is waiting in the queue and which campaigns are live', async () => {
    await handle(ACTIONS.OUTREACH_INVITE, { publicId: 'adalovelace', note: 'Hi' }, 'mcp');
    const c = (await handle(ACTIONS.CAMPAIGN_CREATE, { name: 'A', steps: [] })).data;
    await handle(ACTIONS.CAMPAIGN_PAUSE, { campaignId: c.campaignId });
    await handle(ACTIONS.CAMPAIGN_CREATE, { name: 'B', steps: [] });

    const s = (await handle(ACTIONS.STATUS_GET, {})).data;
    expect(s.queue.pending).toBe(1);
    expect(s.campaigns).toEqual({ active: 1, paused: 1 });
  });

  it('reports the bridge block', async () => {
    await handle(ACTIONS.CONFIG_SET, { bridge: { enabled: true, port: 47830 } });
    const s = (await handle(ACTIONS.STATUS_GET, {})).data;
    expect(s.bridge).toEqual({ enabled: true, connected: false, port: 47830 });
  });
});

/* ================================================================== */
/*  config.set                                                        */
/* ================================================================== */

describe('config.set', () => {
  it('clamps to the hard caps and persists', async () => {
    const res = await handle(ACTIONS.CONFIG_SET, {
      dailyInviteCap: 9999,
      hourlyCap: 9999,
      minDelayMs: 5,
    });
    expect(res.data.dailyInviteCap).toBe(HARD_CAPS.dailyInviteCap);
    expect(res.data.hourlyCap).toBe(50);
    expect(res.data.minDelayMs).toBe(3000);
    expect((await getConfig()).dailyInviteCap).toBe(HARD_CAPS.dailyInviteCap);
  });

  it('merges nested blocks instead of replacing them', async () => {
    await handle(ACTIONS.CONFIG_SET, { ai: { provider: 'anthropic', apiKey: 'k' } });
    await handle(ACTIONS.CONFIG_SET, { ai: { model: 'claude-opus-5' } });
    const cfg = (await handle(ACTIONS.CONFIG_GET, {})).data;
    expect(cfg.ai).toMatchObject({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-5' });
  });

  it('keeps the enrichment block and rejects an unknown provider', async () => {
    const res = await handle(ACTIONS.CONFIG_SET, {
      enrichment: { provider: 'hunter', apiKey: 'hk' },
    });
    expect(res.data.enrichment).toEqual({ provider: 'hunter', apiKey: 'hk' });

    const bad = await handle(ACTIONS.CONFIG_SET, { enrichment: { provider: 'nope' } });
    expect(bad.data.enrichment.provider).toBe('none');
  });

  it('clearChallenge is a command, not a setting', async () => {
    await quota.noteBackoff(451);
    expect((await quota.pauseState()).challenge).toBeTruthy();

    const res = await handle(ACTIONS.CONFIG_SET, { clearChallenge: true, autopilot: true });
    expect((await quota.pauseState()).challenge).toBeUndefined();
    expect(res.data.autopilot).toBe(true);
    expect(res.data.clearChallenge).toBeUndefined();

    const stored = await storage.get('config');
    expect(stored.clearChallenge).toBeUndefined();
  });

  it('clearChallenge: false does nothing', async () => {
    await quota.noteBackoff(451);
    await handle(ACTIONS.CONFIG_SET, { clearChallenge: false });
    expect((await quota.pauseState()).challenge).toBeTruthy();
  });
});

/* ================================================================== */
/*  export.csv                                                        */
/* ================================================================== */

describe('export.csv', () => {
  it("kind 'profiles' reads the profile store", async () => {
    await storage.putProfile(ada);
    await storage.putProfile({ publicId: 'bobbright', fullName: 'Bob Bright' });

    const res = await handle(ACTIONS.EXPORT_CSV, { kind: 'profiles' });
    expect(res.data.count).toBe(2);
    expect(res.data.filename).toMatch(/^linkedin_export_\d{4}-\d{2}-\d{2}\.csv$/);

    const lines = res.data.csv.split('\n');
    expect(lines[0]).toContain('Full Name');
    expect(res.data.csv).toContain('Ada Lovelace');
    expect(res.data.csv).toContain('Maths; Algorithms');
    expect(res.data.csv).toContain('"London, United Kingdom"'); // quoted because of the comma
  });

  it("kind 'profiles' honours the ad-hoc override", async () => {
    await storage.putProfile(ada);
    const res = await handle(ACTIONS.EXPORT_CSV, {
      kind: 'profiles',
      profiles: [{ fullName: 'Someone Else', url: 'https://www.linkedin.com/in/else/' }],
    });
    expect(res.data.count).toBe(1);
    expect(res.data.csv).toContain('Someone Else');
    expect(res.data.csv).not.toContain('Ada Lovelace');
  });

  it("kind 'list' exports the members with their derived columns", async () => {
    const list = (await handle(ACTIONS.LIST_CREATE, { name: 'Targets', tags: ['company:Analytical Engines'] })).data;
    await handle(ACTIONS.LIST_ADD, { listId: list.listId, profiles: [ada] });
    await storage.logAction({ action: ACTIONS.OUTREACH_MESSAGE, publicId: 'adalovelace' });

    const res = await handle(ACTIONS.EXPORT_CSV, { kind: 'list', id: list.listId });
    expect(res.data.count).toBe(1);
    expect(res.data.filename).toMatch(/^linkedin_list_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(res.data.csv.split('\n')[0]).toContain('Contacted Before');
    expect(res.data.csv).toContain('Ada Lovelace');
    expect(res.data.csv).toContain('yes');
    expect(res.data.csv).toContain('atTargetCompany');
  });

  it("kind 'list' needs an id and reports an unknown list", async () => {
    expect((await handle(ACTIONS.EXPORT_CSV, { kind: 'list' })).error.code).toBe(
      ERROR.INVALID_PARAMS,
    );
    expect((await handle(ACTIONS.EXPORT_CSV, { kind: 'list', id: 'nope' })).error.code).toBe(
      ERROR.NOT_FOUND,
    );
  });

  it("kind 'campaign' exports the enrollments and what was sent", async () => {
    await storage.putProfile(ada);
    const c = (
      await handle(ACTIONS.CAMPAIGN_CREATE, {
        name: 'Outreach',
        steps: [{ type: 'view' }],
        publicIds: ['adalovelace'],
      })
    ).data;
    await storage.logAction({
      action: ACTIONS.OUTREACH_INVITE,
      publicId: 'adalovelace',
      campaignId: c.campaignId,
      result: { status: 'sent' },
    });

    const res = await handle(ACTIONS.EXPORT_CSV, { kind: 'campaign', id: c.campaignId });
    expect(res.data.csv.split('\n')[0]).toContain('Actions Sent');
    expect(res.data.csv).toContain('adalovelace');
    expect(res.data.csv).toContain('Ada Lovelace');
    expect(res.data.csv.trim().split('\n')[1]).toMatch(/,1$/);
  });

  it("kind 'inbox' exports the stored threads", async () => {
    seedSession();
    net.push(conversations);
    await handle(ACTIONS.INBOX_THREADS, {});

    const res = await handle(ACTIONS.EXPORT_CSV, { kind: 'inbox' });
    expect(res.data.count).toBe(2);
    expect(res.data.csv.split('\n')[0]).toContain('Thread Id');
    expect(res.data.csv).toContain('2-abc123');
    expect(res.data.csv).toContain('Ada Lovelace');
  });

  it('refuses to export nothing', async () => {
    expect((await handle(ACTIONS.EXPORT_CSV, { kind: 'profiles' })).error.code).toBe(
      ERROR.NOT_FOUND,
    );
  });

  it('downloads through chrome.downloads with a data: URL when asked', async () => {
    await storage.putProfile(ada);
    const res = await handle(ACTIONS.EXPORT_CSV, { kind: 'profiles', download: true });

    expect(res.data.downloaded).toBe(true);
    expect(chrome.__mock.downloads).toHaveLength(1);
    const download = chrome.__mock.downloads[0];
    expect(download.filename).toBe(res.data.filename);
    expect(download.url.startsWith('data:text/csv;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(download.url.split(',')[1])).toContain('Ada Lovelace');
  });

  it('does not download unless asked', async () => {
    await storage.putProfile(ada);
    await handle(ACTIONS.EXPORT_CSV, { kind: 'profiles' });
    expect(chrome.__mock.downloads).toHaveLength(0);
  });
});

/* ================================================================== */
/*  sync.pull                                                         */
/* ================================================================== */

describe('sync.pull', () => {
  it('returns every collection the contract names', async () => {
    const res = await handle(ACTIONS.SYNC_PULL, {});
    expect(Object.keys(res.data).sort()).toEqual([
      'actions',
      'campaigns',
      'enrollments',
      'events',
      'lists',
      'listMembers',
      'messages',
      'profiles',
      'threads',
    ].sort());
    for (const value of Object.values(res.data)) expect(Array.isArray(value)).toBe(true);
  });

  it('filters everything on updatedAt', async () => {
    seedSession();
    await storage.putProfile(ada);
    const list = (await handle(ACTIONS.LIST_CREATE, { name: 'Early' })).data;
    await handle(ACTIONS.LIST_ADD, { listId: list.listId, profiles: [ada] });
    await handle(ACTIONS.CAMPAIGN_CREATE, { name: 'Early', steps: [], publicIds: ['adalovelace'] });
    await storage.logAction({ action: ACTIONS.OUTREACH_VIEW, publicId: 'adalovelace' });

    const all = (await handle(ACTIONS.SYNC_PULL, {})).data;
    expect(all.profiles).toHaveLength(1);
    expect(all.lists).toHaveLength(1);
    expect(all.listMembers).toHaveLength(1);
    expect(all.campaigns).toHaveLength(1);
    expect(all.enrollments).toHaveLength(1);
    expect(all.actions).toHaveLength(1);

    const cutoff = Date.now();
    vi.setSystemTime(new Date(cutoff + 60000));

    const nothing = (await handle(ACTIONS.SYNC_PULL, { since: cutoff })).data;
    for (const [key, value] of Object.entries(nothing)) {
      expect(value, key).toHaveLength(0);
    }

    await storage.putProfile({ publicId: 'bobbright', fullName: 'Bob Bright' });
    const something = (await handle(ACTIONS.SYNC_PULL, { since: cutoff })).data;
    expect(something.profiles.map((p) => p.publicId)).toEqual(['bobbright']);
    expect(something.lists).toHaveLength(0);
  });

  it('tags list members with their listId and enrollments with their campaignId', async () => {
    await storage.putProfile(ada);
    const list = (await handle(ACTIONS.LIST_CREATE, { name: 'L' })).data;
    await handle(ACTIONS.LIST_ADD, { listId: list.listId, profiles: [ada] });
    const c = (
      await handle(ACTIONS.CAMPAIGN_CREATE, { name: 'C', steps: [], publicIds: ['adalovelace'] })
    ).data;

    const out = (await handle(ACTIONS.SYNC_PULL, {})).data;
    expect(out.listMembers[0].listId).toBe(list.listId);
    expect(out.enrollments[0].campaignId).toBe(c.campaignId);
  });

  it('includes threads, messages and events', async () => {
    seedSession();
    net.push(conversations);
    await inbox.detectReplies();
    await handle(ACTIONS.OUTREACH_INVITE, { publicId: 'adalovelace', note: 'Hi' }, 'mcp');

    const out = (await handle(ACTIONS.SYNC_PULL, {})).data;
    expect(out.threads.length).toBeGreaterThan(0);
    expect(out.events.map((e) => e.event)).toContain('queue_item_added');
  });
});
