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

import { ACTIONS, ERROR, EngineError } from '../lib/actions.js';
import { handle, register } from './engine.js';
import * as quota from './quota.js';
import { getConfig, setConfig } from '../lib/config.js';


// Feature modules register their own contract actions on import.
import './extract.js';
import './lists.js';
import './queue.js';
import './outreach.js';
import './ai.js';

/* ================================================================== */
/*  Quotas and pacing live in quota.js; outreach.js wires the engine's  */
/*  rate-limit provider.                                               */
/* ================================================================== */

const { humanDelay, isWithinBusinessHours } = quota;

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
/*  CSV                                                               */
/* ================================================================== */

const CSV_COLUMNS = [
  ['Full Name', 'fullName'],
  ['First Name', 'firstName'],
  ['Last Name', 'lastName'],
  ['Headline', 'headline'],
  ['Title', 'title'],
  ['Company', 'company'],
  ['Location', 'location'],
  ['Industry', 'industry'],
  ['LinkedIn URL', 'url'],
  ['Summary', 'summary'],
  ['Skills', 'skills'],
];

function escapeCsv(value) {
  const str = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function profilesToCsv(profiles) {
  if (!profiles || !profiles.length) return '';
  const header = CSV_COLUMNS.map(([label]) => label).join(',');
  const rows = profiles.map((p) =>
    CSV_COLUMNS.map(([, key]) => escapeCsv(key === 'url' ? p.url || p.linkedinUrl : p[key])).join(
      ',',
    ),
  );
  return [header, ...rows].join('\n');
}

/**
 * A service worker has no `URL.createObjectURL`, so the CSV is handed to the
 * downloads API as a data URL.
 */
async function downloadCsv(csv, filename) {
  if (!csv) throw new Error('No data to export.');
  await chrome.downloads.download({
    url: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`,
    filename,
    saveAs: true,
  });
  return { ok: true, filename };
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
/*  Campaigns (v1 engine, kept until WS-B's campaigns.js lands)        */
/* ================================================================== */

async function getCampaigns() {
  const data = await chrome.storage.local.get('campaigns');
  return data.campaigns || [];
}

async function saveCampaigns(campaigns) {
  await chrome.storage.local.set({ campaigns });
}

async function createCampaign({ name, steps, contacts }) {
  const campaigns = await getCampaigns();
  const campaign = {
    campaignId: `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    status: 'active',
    steps: steps || [],
    contacts: (contacts || []).map((c) => ({
      ...c,
      currentStep: 0,
      stepCompleted: {},
      lastStepAt: null,
      replied: false,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  campaign.id = campaign.campaignId; // v1 popup reads `id`
  campaigns.push(campaign);
  await saveCampaigns(campaigns);
  return campaign;
}

function findCampaign(campaigns, campaignId) {
  const camp = campaigns.find((c) => c.campaignId === campaignId || c.id === campaignId);
  if (!camp) throw new EngineError(ERROR.NOT_FOUND, `Campaign ${campaignId} not found`);
  return camp;
}

async function setCampaignStatus(campaignId, status) {
  const campaigns = await getCampaigns();
  const camp = findCampaign(campaigns, campaignId);
  camp.status = status;
  camp.updatedAt = Date.now();
  await saveCampaigns(campaigns);
  return camp;
}

async function deleteCampaign(campaignId) {
  const campaigns = await getCampaigns();
  const camp = findCampaign(campaigns, campaignId);
  await saveCampaigns(campaigns.filter((c) => c !== camp));
  return camp;
}

function renderTemplate(template, contact) {
  if (!template) return '';
  return template
    .replace(/\{\{firstName\}\}/g, contact.firstName || '')
    .replace(/\{\{lastName\}\}/g, contact.lastName || '')
    .replace(
      /\{\{fullName\}\}/g,
      contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
    )
    .replace(/\{\{company\}\}/g, contact.company || '')
    .replace(/\{\{title\}\}/g, contact.title || contact.headline || '')
    .replace(/\{\{headline\}\}/g, contact.headline || '');
}

async function runCampaignTick() {
  const config = await getConfig();
  if (config.businessHoursOnly && !isWithinBusinessHours(config)) {
    return { executed: 0, queued: 0 };
  }

  const campaigns = await getCampaigns();
  let executed = 0;
  let queued = 0;
  let modified = false;

  for (const campaign of campaigns) {
    if (campaign.status !== 'active') continue;
    if (!campaign.steps.length || !campaign.contacts.length) continue;

    let allDone = true;

    for (const contact of campaign.contacts) {
      if (contact.replied) continue;
      if (contact.currentStep >= campaign.steps.length) continue;

      allDone = false;
      const step = campaign.steps[contact.currentStep];

      if (step.type === 'wait') {
        const waitMs = (step.delay_hours || 24) * 60 * 60 * 1000;
        if (contact.lastStepAt && Date.now() - new Date(contact.lastStepAt).getTime() < waitMs) {
          queued++;
          continue;
        }
        contact.stepCompleted[contact.currentStep] = true;
        contact.currentStep++;
        contact.lastStepAt = new Date().toISOString();
        modified = true;
        continue;
      }

      if (contact.lastStepAt) {
        const minDelay = (step.delay_hours || 0) * 60 * 60 * 1000;
        if (Date.now() - new Date(contact.lastStepAt).getTime() < minDelay) {
          queued++;
          continue;
        }
      }

      const action = CAMPAIGN_STEP_ACTIONS[step.type];
      if (!action) continue;

      const params = campaignStepParams(step, contact);
      if (!params) continue;

      const res = await handle(action, params, 'campaign');
      if (!res.ok) {
        queued++;
        console.warn(`[Campaign] ${step.type} failed for ${contact.publicIdentifier}:`, res.error);
        continue;
      }

      executed++;
      contact.stepCompleted[contact.currentStep] = true;
      contact.currentStep++;
      contact.lastStepAt = new Date().toISOString();
      modified = true;

      await humanDelay();
    }

    if (allDone) {
      campaign.status = 'completed';
      campaign.updatedAt = Date.now();
      modified = true;
    }
  }

  if (modified) await saveCampaigns(campaigns);
  return { executed, queued };
}

const CAMPAIGN_STEP_ACTIONS = {
  view_profile: ACTIONS.OUTREACH_VIEW,
  send_invite: ACTIONS.OUTREACH_INVITE,
  send_message: ACTIONS.OUTREACH_MESSAGE,
};

function campaignStepParams(step, contact) {
  const publicId = contact.publicIdentifier || contact.publicId;
  if (!publicId) return null;
  if (step.type === 'view_profile') return { publicId };
  if (step.type === 'send_invite') {
    return {
      publicId,
      note: renderTemplate(step.message_template, contact),
      profileUrn: contact.profileUrn || contact.entityUrn || '',
    };
  }
  if (step.type === 'send_message') {
    return {
      publicId,
      body: renderTemplate(step.message_template, contact),
      recipientUrn: contact.entityUrn || contact.profileUrn || '',
    };
  }
  return null;
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

register(ACTIONS.STATUS_GET, async () => {
  const config = await getConfig();
  const campaigns = await getCampaigns();
  const quotas = await quota.snapshotAll();
  const paused = await quota.pauseState();

  let loggedIn = false;
  try {
    const cookie = await chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' });
    loggedIn = !!(cookie && cookie.value);
  } catch {
    loggedIn = false;
  }

  return {
    connected: true,
    extensionVersion: chrome.runtime.getManifest().version,
    loggedIn,
    autopilot: config.autopilot,
    businessHours: isWithinBusinessHours(config),
    ...paused,
    quotas,
    queue: { pending: 0 },
    campaigns: {
      active: campaigns.filter((c) => c.status === 'active').length,
      paused: campaigns.filter((c) => c.status === 'paused').length,
    },
  };
});

register(ACTIONS.CONFIG_GET, () => getConfig());
register(ACTIONS.CONFIG_SET, (params) => setConfig(params));

register(ACTIONS.NETWORK_UNFOLLOW_COUNT, () => unfollowCount());
register(ACTIONS.NETWORK_UNFOLLOW_ALL, () => unfollowAll());

register(ACTIONS.CAMPAIGN_CREATE, (params) => createCampaign(params));
register(ACTIONS.CAMPAIGN_GET_ALL, async () => ({ campaigns: await getCampaigns() }));
register(ACTIONS.CAMPAIGN_GET, async ({ campaignId }) =>
  findCampaign(await getCampaigns(), campaignId),
);
register(ACTIONS.CAMPAIGN_PAUSE, ({ campaignId }) => setCampaignStatus(campaignId, 'paused'));
register(ACTIONS.CAMPAIGN_RESUME, ({ campaignId }) => setCampaignStatus(campaignId, 'active'));
register(ACTIONS.CAMPAIGN_DELETE, ({ campaignId }) => deleteCampaign(campaignId));
register(ACTIONS.CAMPAIGN_TICK, () => runCampaignTick());

register(ACTIONS.EXPORT_CSV, async ({ kind, profiles }) => {
  if (kind !== 'profiles' || !profiles || !profiles.length) {
    throw new EngineError(ERROR.NOT_FOUND, `No data to export for kind '${kind}'`);
  }
  return {
    csv: profilesToCsv(profiles),
    filename: `linkedin_export_${new Date().toISOString().slice(0, 10)}.csv`,
  };
});

/* ================================================================== */
/*  Legacy message adapters (removed with the v1 popup)               */
/* ================================================================== */

const usageView = (rl) => ({ hourly: rl.hourlyUsed, daily: rl.dailyUsed });

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
    params: (msg) => ({ kind: 'profiles', profiles: msg.profiles }),
    result: async (data, msg) => {
      await downloadCsv(data.csv, data.filename);
      return { ok: true, filename: data.filename, count: (msg.profiles || []).length };
    },
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

  GET_CAMPAIGNS: { action: ACTIONS.CAMPAIGN_GET_ALL, result: (data) => data.campaigns },
  CREATE_CAMPAIGN: {
    action: ACTIONS.CAMPAIGN_CREATE,
    params: (msg) => ({
      name: msg.name || 'Untitled Campaign',
      steps: msg.steps || [],
      contacts: msg.contacts || [],
    }),
  },
  UPDATE_CAMPAIGN_STATUS: {
    action: (msg) => (msg.status === 'paused' ? ACTIONS.CAMPAIGN_PAUSE : ACTIONS.CAMPAIGN_RESUME),
    params: (msg) => ({ campaignId: msg.campaignId }),
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

/** Set by bridge.js once it lands; called on every wake-up. */
let bridgeConnect = null;

export function setBridgeConnector(fn) {
  bridgeConnect = typeof fn === 'function' ? fn : null;
}

function reconnectBridge() {
  if (!bridgeConnect) return;
  Promise.resolve()
    .then(() => bridgeConnect())
    .catch((e) => console.warn('[Bridge] reconnect failed:', e.message));
}

chrome.alarms.create('campaignTick', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'campaignTick') return;
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
