import { describe, it, expect } from 'vitest';

import { ACTIONS, HARD_CAPS } from '../../src/lib/actions.js';
import { route } from '../../src/background/index.js';

const mock = () => globalThis.chrome.__mock;

/** Every caller now speaks the contract envelope; there is no legacy path. */
const call = async (action, params = {}) => {
  const res = await route({ action, params });
  if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
  return res.data;
};

describe('service worker wiring', () => {
  it('registers the message, alarm, startup and install listeners', () => {
    expect(mock().listeners.onMessage.length).toBeGreaterThan(0);
    expect(mock().listeners.onAlarm.length).toBeGreaterThan(0);
    expect(mock().listeners.onStartup.length).toBeGreaterThan(0);
    expect(mock().listeners.onInstalled.length).toBeGreaterThan(0);
  });
});

describe('route', () => {
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

  it('rejects a message that is not an { action, params } envelope', async () => {
    for (const msg of [null, 'nope', { type: 'GET_CONFIG' }]) {
      const res = await route(msg);
      expect(res.ok).toBe(false);
      expect(res.error.code).toBe('INVALID_PARAMS');
      expect(res.error.message).toMatch(/action, params/);
    }
  });
});

describe('config', () => {
  it('serves the contract defaults', async () => {
    const config = await call(ACTIONS.CONFIG_GET);
    expect(config.minDelayMs).toBe(8000);
    expect(config.hourlyCap).toBe(20);
    expect(config.dailyInviteCap).toBe(25);
    expect(config.autopilot).toBe(false);
  });

  it('saves settings through the clamp', async () => {
    const saved = await call(ACTIONS.CONFIG_SET, {
      dailyInviteCap: 999,
      hourlyCap: 999,
      minDelayMs: 10,
    });
    expect(saved.dailyInviteCap).toBe(HARD_CAPS.dailyInviteCap);
    expect(saved.hourlyCap).toBe(50);
    expect(saved.minDelayMs).toBe(3000);

    const stored = await chrome.storage.local.get('config');
    expect(stored.config.dailyInviteCap).toBe(HARD_CAPS.dailyInviteCap);
  });
});

describe('network.unfollowCount', () => {
  it('counts unfollow buttons in the active tab', async () => {
    await chrome.tabs.create({
      url: 'https://www.linkedin.com/mynetwork/network-manager/people-follow/following/',
      active: true,
    });
    mock().executeScriptResult = [{ result: 7 }];

    expect(await call(ACTIONS.NETWORK_UNFOLLOW_COUNT)).toEqual({ count: 7 });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});

describe('mass unfollow is popup-only', () => {
  it.each([ACTIONS.NETWORK_UNFOLLOW_COUNT, ACTIONS.NETWORK_UNFOLLOW_ALL])(
    '%s refuses every origin but the popup',
    async (action) => {
      for (const origin of ['mcp', 'cli', 'campaign', 'system']) {
        const res = await route({ action, params: {}, origin });
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe('UNAUTHORIZED');
        expect(res.error.message).toMatch(/Run it from the popup/);
      }
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    },
  );

  it('still lets the popup through', async () => {
    await chrome.tabs.create({
      url: 'https://www.linkedin.com/mynetwork/network-manager/people-follow/following/',
      active: true,
    });
    mock().executeScriptResult = [{ result: 3 }];

    const res = await route({ action: ACTIONS.NETWORK_UNFOLLOW_COUNT, params: {} });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ count: 3 });
  });
});

describe('export.csv', () => {
  it('builds a CSV from the profiles the caller passes back', async () => {
    const profiles = [
      {
        fullName: 'Ada Lovelace',
        firstName: 'Ada',
        lastName: 'Lovelace',
        headline: 'Engineer, Analyst',
        url: 'https://www.linkedin.com/in/ada/',
        skills: ['maths', 'engines'],
      },
    ];
    const { csv, filename } = await call(ACTIONS.EXPORT_CSV, { kind: 'profiles', profiles });

    expect(filename).toMatch(/^linkedin_export_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.split('\n')[0]).toContain('Full Name');
    expect(csv).toContain('"Engineer, Analyst"');
    expect(csv).toContain('https://www.linkedin.com/in/ada/');
    expect(csv).toContain('maths; engines');
  });

  it('refuses to export nothing', async () => {
    const res = await route({
      action: ACTIONS.EXPORT_CSV,
      params: { kind: 'profiles', profiles: [] },
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toMatch(/No data to export/);
  });
});

describe('campaigns', () => {
  it('creates, lists, pauses, resumes and deletes', async () => {
    const created = await call(ACTIONS.CAMPAIGN_CREATE, {
      name: 'Founders',
      steps: [{ type: 'view' }],
      contacts: [{ publicIdentifier: 'ada' }],
    });
    expect(created.name).toBe('Founders');
    expect(created.status).toBe('active');

    expect((await call(ACTIONS.CAMPAIGN_GET_ALL)).campaigns).toHaveLength(1);

    const paused = await call(ACTIONS.CAMPAIGN_PAUSE, { campaignId: created.campaignId });
    expect(paused.status).toBe('paused');

    const resumed = await call(ACTIONS.CAMPAIGN_RESUME, { campaignId: created.campaignId });
    expect(resumed.status).toBe('active');

    await call(ACTIONS.CAMPAIGN_DELETE, { campaignId: created.campaignId });
    expect((await call(ACTIONS.CAMPAIGN_GET_ALL)).campaigns).toHaveLength(0);
  });

  it('reports a missing campaign as an error envelope', async () => {
    const res = await route({
      action: ACTIONS.CAMPAIGN_DELETE,
      params: { campaignId: 'nope' },
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toMatch(/Campaign nope not found/);
  });

  it('runs a tick without doing anything when there are no campaigns', async () => {
    expect(await call(ACTIONS.CAMPAIGN_TICK)).toEqual({ executed: 0, queued: 0 });
  });
});
