import { describe, it, expect } from 'vitest';

import { ACTIONS, HARD_CAPS } from '../../src/lib/actions.js';
import { route, LEGACY_MAP, toLegacyConfig, fromLegacyConfig } from '../../src/background/index.js';

const mock = () => globalThis.chrome.__mock;

describe('service worker wiring', () => {
  it('registers the message, alarm, startup and install listeners', () => {
    expect(mock().listeners.onMessage.length).toBeGreaterThan(0);
    expect(mock().listeners.onAlarm.length).toBeGreaterThan(0);
    expect(mock().listeners.onStartup.length).toBeGreaterThan(0);
    expect(mock().listeners.onInstalled.length).toBeGreaterThan(0);
  });
});

describe('LEGACY_MAP', () => {
  it('maps every old message type onto a contract action', () => {
    const known = new Set(Object.values(ACTIONS));
    for (const [type, entry] of Object.entries(LEGACY_MAP)) {
      const actions =
        typeof entry.action === 'function'
          ? [entry.action({ status: 'paused' }), entry.action({ status: 'active' })]
          : [entry.action];
      for (const action of actions) {
        expect(known.has(action), `${type} → ${action}`).toBe(true);
      }
    }
  });

  it('covers every message type the v1 UI sends', () => {
    const v1Types = [
      'GET_CONFIG',
      'SET_CONFIG',
      'GET_USAGE',
      'GET_QUOTAS',
      'UNFOLLOW_COUNT',
      'UNFOLLOW_ALL',
      'EXPORT_PROFILE',
      'SEARCH_EXPORT',
      'DOWNLOAD_CSV',
      'SEND_INVITE',
      'SEND_MESSAGE',
      'GET_CAMPAIGNS',
      'CREATE_CAMPAIGN',
      'UPDATE_CAMPAIGN_STATUS',
      'DELETE_CAMPAIGN',
      'RUN_CAMPAIGN_TICK',
    ];
    for (const type of v1Types) expect(Object.keys(LEGACY_MAP)).toContain(type);
  });
});

describe('config key translation', () => {
  it('round-trips the v1 key names', () => {
    const legacy = {
      minDelayMs: 8000,
      maxDelayMs: 15000,
      maxPerHour: 20,
      windowStartHour: 9,
      windowEndHour: 18,
      windowWeekdaysOnly: true,
      maxInvitesPerDay: 25,
      maxMessagesPerDay: 50,
    };
    expect(toLegacyConfig(fromLegacyConfig(legacy))).toEqual(legacy);
  });

  it('passes unknown keys through untouched', () => {
    expect(fromLegacyConfig({ autopilot: true })).toEqual({ autopilot: true });
  });
});

describe('route — v2 envelopes', () => {
  it('answers a contract action with an envelope', async () => {
    const res = await route({ action: ACTIONS.STATUS_GET, params: {} });
    expect(res.ok).toBe(true);
    expect(res.data.connected).toBe(true);
    expect(res.data.extensionVersion).toBe('2.0.0');
    expect(res.data.loggedIn).toBe(false);
    expect(Object.keys(res.data.quotas).sort()).toEqual(['invite', 'message', 'search', 'visit']);
    expect(res.data.campaigns).toEqual({ active: 0, paused: 0 });
  });

  it('reports an unknown action as INVALID_PARAMS', async () => {
    const res = await route({ action: 'made.up' });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_PARAMS');
  });
});

describe('route — legacy messages', () => {
  it('returns raw data, not an envelope', async () => {
    const cfg = await route({ type: 'GET_CONFIG' });
    expect(cfg).toEqual({
      minDelayMs: 8000,
      maxDelayMs: 15000,
      maxPerHour: 20,
      windowStartHour: 9,
      windowEndHour: 18,
      windowWeekdaysOnly: true,
      maxInvitesPerDay: 25,
      maxMessagesPerDay: 50,
    });
  });

  it('saves settings through the clamp', async () => {
    const saved = await route({
      type: 'SET_CONFIG',
      config: { maxInvitesPerDay: 999, maxPerHour: 999, minDelayMs: 10 },
    });
    expect(saved.maxInvitesPerDay).toBe(HARD_CAPS.dailyInviteCap);
    expect(saved.maxPerHour).toBe(50);
    expect(saved.minDelayMs).toBe(3000);

    const stored = await chrome.storage.local.get('config');
    expect(stored.config.dailyInviteCap).toBe(HARD_CAPS.dailyInviteCap);
  });

  it('serves the v1 usage and quota views', async () => {
    expect(await route({ type: 'GET_USAGE' })).toEqual({
      action: { hourly: 0, daily: 0 },
      invite: { hourly: 0, daily: 0 },
      message: { hourly: 0, daily: 0 },
    });
    expect(await route({ type: 'GET_QUOTAS' })).toEqual({
      maxPerHour: 20,
      maxInvitesPerDay: 25,
      maxMessagesPerDay: 50,
    });
  });

  it('reports errors in the v1 { error } shape', async () => {
    expect(await route({ type: 'NOPE' })).toEqual({ error: 'Unknown message type: NOPE' });
    expect(await route({ type: 'EXPORT_PROFILE' })).toEqual({ error: 'No active tab' });
  });

  it('counts unfollow buttons in the active tab', async () => {
    await chrome.tabs.create({
      url: 'https://www.linkedin.com/mynetwork/network-manager/people-follow/following/',
      active: true,
    });
    mock().executeScriptResult = [{ result: 7 }];

    expect(await route({ type: 'UNFOLLOW_COUNT' })).toEqual({ count: 7 });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('downloads a CSV built from the profiles the popup passes back', async () => {
    const profiles = [
      {
        fullName: 'Ada Lovelace',
        firstName: 'Ada',
        lastName: 'Lovelace',
        headline: 'Engineer, Analyst',
        linkedinUrl: 'https://www.linkedin.com/in/ada/',
        skills: ['maths', 'engines'],
      },
    ];
    const res = await route({ type: 'DOWNLOAD_CSV', profiles });

    expect(res.ok).toBe(true);
    expect(res.count).toBe(1);
    expect(res.filename).toMatch(/^linkedin_export_\d{4}-\d{2}-\d{2}\.csv$/);

    expect(mock().downloads).toHaveLength(1);
    const csv = decodeURIComponent(
      mock().downloads[0].url.replace(/^data:text\/csv;charset=utf-8,/, ''),
    );
    expect(csv.split('\n')[0]).toContain('Full Name');
    expect(csv).toContain('"Engineer, Analyst"');
    expect(csv).toContain('https://www.linkedin.com/in/ada/');
    expect(csv).toContain('maths; engines');
  });

  it('refuses to export nothing', async () => {
    const res = await route({ type: 'DOWNLOAD_CSV', profiles: [] });
    expect(res.error).toMatch(/No data to export/);
    expect(mock().downloads).toHaveLength(0);
  });
});

describe('campaigns through the contract actions', () => {
  it('creates, lists, pauses, resumes and deletes', async () => {
    const created = await route({
      type: 'CREATE_CAMPAIGN',
      name: 'Founders',
      steps: [{ type: 'view_profile' }],
      contacts: [{ publicIdentifier: 'ada' }],
    });
    expect(created.name).toBe('Founders');
    expect(created.status).toBe('active');
    expect(created.id).toBe(created.campaignId);

    expect(await route({ type: 'GET_CAMPAIGNS' })).toHaveLength(1);

    const paused = await route({
      type: 'UPDATE_CAMPAIGN_STATUS',
      campaignId: created.campaignId,
      status: 'paused',
    });
    expect(paused.status).toBe('paused');

    const resumed = await route({
      type: 'UPDATE_CAMPAIGN_STATUS',
      campaignId: created.campaignId,
      status: 'active',
    });
    expect(resumed.status).toBe('active');

    expect(await route({ type: 'DELETE_CAMPAIGN', campaignId: created.campaignId })).toEqual({
      ok: true,
    });
    expect(await route({ type: 'GET_CAMPAIGNS' })).toHaveLength(0);
  });

  it('defaults an unnamed campaign the way v1 did', async () => {
    const created = await route({ type: 'CREATE_CAMPAIGN' });
    expect(created.name).toBe('Untitled Campaign');
    expect(created.steps).toEqual([]);
  });

  it('reports a missing campaign in the v1 { error } shape', async () => {
    expect(await route({ type: 'DELETE_CAMPAIGN', campaignId: 'nope' })).toEqual({
      error: 'Campaign nope not found',
    });
  });

  it('runs a tick without doing anything when there are no campaigns', async () => {
    expect(await route({ type: 'RUN_CAMPAIGN_TICK' })).toEqual({ ok: true });
    const res = await route({ action: ACTIONS.CAMPAIGN_TICK, params: {} });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ executed: 0, queued: 0 });
  });
});
