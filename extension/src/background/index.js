/**
 * LinkedIn Toolkit — Background Service Worker (router).
 *
 * This file is deliberately thin: it registers the v1 behaviour under the v2
 * contract action names and routes every inbound message through
 * `engine.handle`. Feature modules (quota, queue, lists, campaigns, inbox, ai,
 * research, bridge) land alongside it and register their own actions.
 *
 * LEGACY_MAP keeps the v1 popup, options page and content script working
 * unchanged by translating their old `type` message strings into contract
 * actions. It is removed once the v2 popup ships.
 */

import { ACTIONS } from '../lib/actions.js';
import { handle, register } from './engine.js';


// Feature modules register their own contract actions on import.
import './extract.js';
import './lists.js';
import './queue.js';
import './outreach.js';
import './ai.js';
import './inbox.js';
import './campaigns.js';
import './capture.js';
import './research.js';
import './status.js';
import './sync.js';

import { migrateSteps } from './campaigns.js';
import { ensureConnected, onAlarm, startKeepalive } from './bridge.js';

/* ================================================================== */
/*  Quotas and pacing live in quota.js; outreach.js wires the engine's  */
/*  rate-limit provider.                                               */
/* ================================================================== */

export const CAMPAIGN_TICK_ALARM = 'campaignTick';

/* ================================================================== */
/*  Profile shaping                                                   */
/* ================================================================== */

function extractPublicId(url) {
  const match = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) throw new Error('No active tab');
  return tabs[0];
}

async function activeProfilePublicId() {
  const tab = await activeTab();
  const publicId = extractPublicId(tab.url || '');
  if (!publicId) throw new Error('Not on a LinkedIn profile page.');
  return publicId;
}

/** Contract Profile → the flat shape the v1 popup and content script expect. */
function toLegacyProfile(p) {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    fullName: p.fullName,
    headline: p.headline,
    title: p.title,
    company: p.company,
    location: p.location,
    summary: p.summary || '',
    industry: p.industry,
    skills: p.skills || [],
    education: p.education || [],
    publicIdentifier: p.publicId,
    linkedinUrl: p.url,
    profileUrn: p.urn,
    entityUrn: p.urn,
    connectionDistance: p.connectionDegree || '',
    snippet: p.summary || '',
    image: p.photoUrl || '',
  };
}

/* ================================================================== */
/*  Mass unfollow (DOM-driven, in the user's own tab)                 */
/* ================================================================== */

const FOLLOWING_URL = 'https://www.linkedin.com/mynetwork/network-manager/people-follow/following/';
const UNFOLLOW_SELECTOR =
  'button[aria-label*="stop following"], button[aria-label*="Stop following"], button[aria-label*="Unfollow"]';

async function ensureFollowingTab(waitMs) {
  const tab = await activeTab();
  if (!tab.url || !tab.url.includes('people-follow/following')) {
    await chrome.tabs.update(tab.id, { url: FOLLOWING_URL });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return tab;
}

async function unfollowCount() {
  const tab = await ensureFollowingTab(3000);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    args: [UNFOLLOW_SELECTOR],
    func: (selector) => document.querySelectorAll(selector).length,
  });
  return { count: results?.[0]?.result || 0 };
}

async function unfollowAll() {
  const tab = await ensureFollowingTab(4000);
  const tabId = tab.id;

  let unfollowed = 0;
  let errors = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [UNFOLLOW_SELECTOR],
      func: async (selector) => {
        const buttons = document.querySelectorAll(selector);
        if (buttons.length === 0) return { clicked: 0, errors: 0, remaining: 0 };

        let clicked = 0;
        let failed = 0;

        for (const btn of buttons) {
          try {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await new Promise((r) => setTimeout(r, 500));
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            await new Promise((r) => setTimeout(r, 50));
            btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            await new Promise((r) => setTimeout(r, 50));
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            clicked++;
            await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
          } catch {
            failed++;
          }
        }

        const showMore = document.querySelector(
          'button.scaffold-finite-scroll__load-button, button[aria-label*="Show more"]',
        );
        if (showMore) {
          showMore.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          await new Promise((r) => setTimeout(r, 2000));
        }

        return {
          clicked,
          errors: failed,
          remaining: document.querySelectorAll(selector).length,
          hasShowMore: !!showMore,
        };
      },
    });

    const data = result?.[0]?.result || { clicked: 0, errors: 0, remaining: 0 };
    unfollowed += data.clicked || 0;
    errors += data.errors || 0;

    Promise.resolve(
      chrome.runtime.sendMessage({
        type: 'UNFOLLOW_PROGRESS',
        unfollowed,
        errors,
        remaining: data.remaining || 0,
      }),
    ).catch(() => {});

    hasMore = (data.clicked || 0) > 0 || !!data.hasShowMore;
    if (hasMore) await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return { unfollowed, errors };
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

register(ACTIONS.NETWORK_UNFOLLOW_COUNT, () => unfollowCount());
register(ACTIONS.NETWORK_UNFOLLOW_ALL, () => unfollowAll());

/* ================================================================== */
/*  Legacy message adapters (removed with the v1 popup)               */
/* ================================================================== */

const usageView = (rl) => ({ hourly: rl.hourlyUsed, daily: rl.dailyUsed });

/** The v1 popup renders `camp.id`. */
const withLegacyId = (campaign) => ({ ...campaign, id: campaign.campaignId });

/** v2 Config → the key names the v1 popup and options page still use. */
function toLegacyConfig(config) {
  return {
    minDelayMs: config.minDelayMs,
    maxDelayMs: config.maxDelayMs,
    maxPerHour: config.hourlyCap,
    windowStartHour: config.businessStart,
    windowEndHour: config.businessEnd,
    windowWeekdaysOnly: config.weekdaysOnly,
    maxInvitesPerDay: config.dailyInviteCap,
    maxMessagesPerDay: config.dailyMessageCap,
  };
}

/** v1 config keys → v2 Config keys (unknown keys pass straight through). */
function fromLegacyConfig(legacy = {}) {
  const RENAME = {
    maxPerHour: 'hourlyCap',
    windowStartHour: 'businessStart',
    windowEndHour: 'businessEnd',
    windowWeekdaysOnly: 'weekdaysOnly',
    maxInvitesPerDay: 'dailyInviteCap',
    maxMessagesPerDay: 'dailyMessageCap',
  };
  const out = {};
  for (const [key, value] of Object.entries(legacy)) out[RENAME[key] || key] = value;
  return out;
}

const LEGACY_MAP = {
  GET_CONFIG: { action: ACTIONS.CONFIG_GET, result: toLegacyConfig },
  SET_CONFIG: {
    action: ACTIONS.CONFIG_SET,
    params: (msg) => fromLegacyConfig(msg.config),
    result: toLegacyConfig,
  },

  GET_USAGE: {
    action: ACTIONS.STATUS_GET,
    result: (status) => ({
      action: usageView(status.quotas.visit),
      invite: usageView(status.quotas.invite),
      message: usageView(status.quotas.message),
    }),
  },
  GET_QUOTAS: {
    action: ACTIONS.STATUS_GET,
    result: (status) => ({
      maxPerHour: status.quotas.invite.hourlyCap,
      maxInvitesPerDay: status.quotas.invite.dailyCap,
      maxMessagesPerDay: status.quotas.message.dailyCap,
    }),
  },

  UNFOLLOW_COUNT: { action: ACTIONS.NETWORK_UNFOLLOW_COUNT },
  UNFOLLOW_ALL: {
    action: ACTIONS.NETWORK_UNFOLLOW_ALL,
    result: (data) => ({ ok: true, unfollowed: data.unfollowed, errors: data.errors || 0 }),
  },

  EXPORT_PROFILE: {
    action: ACTIONS.PROFILE_GET,
    params: async () => ({ publicId: await activeProfilePublicId() }),
    result: toLegacyProfile,
  },

  SEARCH_EXPORT: {
    action: ACTIONS.SEARCH_PEOPLE,
    params: (msg) => ({ keywords: msg.keywords, count: msg.count || 25 }),
    result: (data) => data.profiles.map(toLegacyProfile),
  },

  DOWNLOAD_CSV: {
    action: ACTIONS.EXPORT_CSV,
    params: (msg) => ({ kind: 'profiles', profiles: msg.profiles, download: true }),
    result: (data) => ({ ok: true, filename: data.filename, count: data.count }),
  },

  SEND_INVITE: {
    action: ACTIONS.OUTREACH_INVITE,
    params: (msg) => ({
      publicId: msg.publicIdentifier || msg.publicId,
      note: msg.note,
      profileUrn: msg.profileUrn,
    }),
    result: (data) => ({ ok: data.status === 'sent', ...data }),
  },
  SEND_MESSAGE: {
    action: (msg) =>
      msg.subtype === 'INMAIL' ? ACTIONS.OUTREACH_INMAIL : ACTIONS.OUTREACH_MESSAGE,
    params: async (msg) => ({
      publicId: msg.publicIdentifier || msg.publicId || (await activeProfilePublicId()),
      body: msg.body,
      subject: msg.inmailSubject,
      recipientUrn: msg.recipientUrn,
    }),
  },

  GET_CAMPAIGNS: {
    action: ACTIONS.CAMPAIGN_GET_ALL,
    result: (data) => data.campaigns.map(withLegacyId),
  },
  CREATE_CAMPAIGN: {
    action: ACTIONS.CAMPAIGN_CREATE,
    params: (msg) => ({
      name: msg.name || 'Untitled Campaign',
      steps: migrateSteps(msg.steps || []),
      publicIds: (msg.contacts || [])
        .map((c) => c.publicIdentifier || c.publicId)
        .filter(Boolean),
    }),
    result: withLegacyId,
  },
  UPDATE_CAMPAIGN_STATUS: {
    action: (msg) => (msg.status === 'paused' ? ACTIONS.CAMPAIGN_PAUSE : ACTIONS.CAMPAIGN_RESUME),
    params: (msg) => ({ campaignId: msg.campaignId }),
    result: withLegacyId,
  },
  DELETE_CAMPAIGN: {
    action: ACTIONS.CAMPAIGN_DELETE,
    params: (msg) => ({ campaignId: msg.campaignId }),
    result: () => ({ ok: true }),
  },
  RUN_CAMPAIGN_TICK: { action: ACTIONS.CAMPAIGN_TICK, result: () => ({ ok: true }) },
};

/* ================================================================== */
/*  Router                                                            */
/* ================================================================== */

async function routeLegacy(msg) {
  const entry = LEGACY_MAP[msg.type];
  if (!entry) return { error: `Unknown message type: ${msg.type}` };

  try {
    const action = typeof entry.action === 'function' ? entry.action(msg) : entry.action;
    const params = entry.params ? await entry.params(msg) : {};
    const res = await handle(action, params, 'popup');
    if (!res.ok) return { error: res.error.message };
    return entry.result ? await entry.result(res.data, msg) : res.data;
  } catch (e) {
    return { error: e.message };
  }
}

export async function route(msg) {
  if (!msg || typeof msg !== 'object') return { error: 'Empty message' };
  if (typeof msg.action === 'string') {
    return handle(msg.action, msg.params || {}, msg.origin || 'popup');
  }
  return routeLegacy(msg);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  route(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true;
});

/* ================================================================== */
/*  Alarms, startup and bridge reconnect                              */
/* ================================================================== */

function reconnectBridge() {
  Promise.resolve()
    .then(() => ensureConnected())
    .catch((e) => console.warn('[Bridge] reconnect failed:', e.message));
}

chrome.alarms.create(CAMPAIGN_TICK_ALARM, { periodInMinutes: 5 });
startKeepalive();

chrome.alarms.onAlarm.addListener((alarm) => {
  onAlarm(alarm).catch(() => {});
  if (alarm.name !== CAMPAIGN_TICK_ALARM) return;
  reconnectBridge();
  handle(ACTIONS.CAMPAIGN_TICK, {}, 'system')
    .then((res) => {
      if (!res.ok) console.warn('[Campaign tick]', res.error);
    })
    .catch((e) => console.error('[Campaign tick error]', e));
});

chrome.runtime.onStartup.addListener(reconnectBridge);
chrome.runtime.onInstalled.addListener(reconnectBridge);

export { LEGACY_MAP, toLegacyConfig, fromLegacyConfig };
