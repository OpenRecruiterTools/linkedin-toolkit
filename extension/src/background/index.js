/**
 * LinkedIn Toolkit — Background Service Worker
 *
 * Handles all message routing, campaign execution, rate limiting,
 * mass unfollow, profile export, search, and settings management.
 */

import {
  getProfile,
  normalizeProfile,
  searchPeople,
  normalizeSearchCluster,
  sendInvite,
  sendMessage,
} from './voyager.js';

/* ================================================================== */
/*  Configuration                                                     */
/* ================================================================== */

const DEFAULT_CONFIG = {
  minDelayMs: 8000,
  maxDelayMs: 15000,
  maxPerHour: 40,
  windowStartHour: 9,
  windowEndHour: 18,
  windowWeekdaysOnly: true,
  maxInvitesPerDay: 25,
  maxMessagesPerDay: 50,
};

async function getConfig() {
  const data = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...(data.config || {}) };
}

async function setConfig(partial) {
  const current = await getConfig();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ config: updated });
  return updated;
}

/* ================================================================== */
/*  Usage tracking                                                    */
/* ================================================================== */

async function getUsageKey(action) {
  const now = new Date();
  const hourKey = `usage_${action}_${now.getFullYear()}_${now.getMonth()}_${now.getDate()}_${now.getHours()}`;
  const dayKey = `usage_${action}_day_${now.getFullYear()}_${now.getMonth()}_${now.getDate()}`;
  return { hourKey, dayKey };
}

async function incrementUsage(action) {
  const { hourKey, dayKey } = await getUsageKey(action);
  const data = await chrome.storage.local.get([hourKey, dayKey]);
  await chrome.storage.local.set({
    [hourKey]: (data[hourKey] || 0) + 1,
    [dayKey]: (data[dayKey] || 0) + 1,
  });
}

async function getUsageCounts(action) {
  const { hourKey, dayKey } = await getUsageKey(action);
  const data = await chrome.storage.local.get([hourKey, dayKey]);
  return {
    hourly: data[hourKey] || 0,
    daily: data[dayKey] || 0,
  };
}

async function checkQuota(action) {
  const config = await getConfig();
  const usage = await getUsageCounts(action);

  if (usage.hourly >= config.maxPerHour) {
    return { allowed: false, reason: `Hourly cap reached (${config.maxPerHour}/hr)` };
  }

  if (action === 'invite' && usage.daily >= config.maxInvitesPerDay) {
    return { allowed: false, reason: `Daily invite cap reached (${config.maxInvitesPerDay}/day)` };
  }

  if (action === 'message' && usage.daily >= config.maxMessagesPerDay) {
    return { allowed: false, reason: `Daily message cap reached (${config.maxMessagesPerDay}/day)` };
  }

  return { allowed: true };
}

/* ================================================================== */
/*  Time window enforcement                                           */
/* ================================================================== */

function isWithinBusinessHours(config) {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun, 6=Sat

  if (config.windowWeekdaysOnly && (day === 0 || day === 6)) {
    return false;
  }

  return hour >= config.windowStartHour && hour < config.windowEndHour;
}

/* ================================================================== */
/*  Human-paced delay                                                 */
/* ================================================================== */

async function humanDelay() {
  const config = await getConfig();
  const ms = config.minDelayMs + Math.random() * (config.maxDelayMs - config.minDelayMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ================================================================== */
/*  Campaign system                                                   */
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
    id: `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name || 'Untitled Campaign',
    status: 'active',
    steps: steps || [],
    contacts: (contacts || []).map((c) => ({
      ...c,
      currentStep: 0,
      stepCompleted: {},
      lastStepAt: null,
      replied: false,
    })),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  campaigns.push(campaign);
  await saveCampaigns(campaigns);
  return campaign;
}

async function updateCampaignStatus(campaignId, status) {
  const campaigns = await getCampaigns();
  const camp = campaigns.find((c) => c.id === campaignId);
  if (!camp) throw new Error(`Campaign ${campaignId} not found`);
  camp.status = status;
  camp.updated_at = new Date().toISOString();
  await saveCampaigns(campaigns);
  return camp;
}

async function deleteCampaign(campaignId) {
  let campaigns = await getCampaigns();
  campaigns = campaigns.filter((c) => c.id !== campaignId);
  await saveCampaigns(campaigns);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Campaign runner                                                   */
/* ------------------------------------------------------------------ */

async function runCampaignTick() {
  const config = await getConfig();

  if (!isWithinBusinessHours(config)) return;

  const campaigns = await getCampaigns();
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

      // Check wait step
      if (step.type === 'wait') {
        const waitMs = (step.delay_hours || 24) * 60 * 60 * 1000;
        if (contact.lastStepAt && Date.now() - new Date(contact.lastStepAt).getTime() < waitMs) {
          continue;
        }
        contact.stepCompleted[contact.currentStep] = true;
        contact.currentStep++;
        contact.lastStepAt = new Date().toISOString();
        modified = true;
        continue;
      }

      // Check delay since last step
      if (contact.lastStepAt) {
        const minDelay = (step.delay_hours || 0) * 60 * 60 * 1000;
        if (Date.now() - new Date(contact.lastStepAt).getTime() < minDelay) {
          continue;
        }
      }

      // Check rate limits
      const quota = await checkQuota(step.type === 'send_invite' ? 'invite' : 'action');
      if (!quota.allowed) continue;

      try {
        switch (step.type) {
          case 'view_profile':
            if (contact.publicIdentifier) {
              await getProfile(contact.publicIdentifier);
              await incrementUsage('action');
            }
            break;

          case 'send_invite':
            if (contact.publicIdentifier) {
              const inviteQuota = await checkQuota('invite');
              if (!inviteQuota.allowed) continue;
              await sendInvite({
                publicIdentifier: contact.publicIdentifier,
                profileUrn: contact.profileUrn || contact.entityUrn || '',
                note: renderTemplate(step.message_template, contact),
              });
              await incrementUsage('invite');
            }
            break;

          case 'send_message':
            if (contact.entityUrn || contact.profileUrn) {
              const msgQuota = await checkQuota('message');
              if (!msgQuota.allowed) continue;
              await sendMessage({
                recipientUrn: contact.entityUrn || contact.profileUrn,
                body: renderTemplate(step.message_template, contact),
              });
              await incrementUsage('message');
            }
            break;
        }

        contact.stepCompleted[contact.currentStep] = true;
        contact.currentStep++;
        contact.lastStepAt = new Date().toISOString();
        modified = true;

        await humanDelay();
      } catch (err) {
        console.warn(`[Campaign] Step failed for ${contact.publicIdentifier}:`, err.message);
      }
    }

    if (allDone) {
      campaign.status = 'completed';
      campaign.updated_at = new Date().toISOString();
      modified = true;
    }
  }

  if (modified) {
    await saveCampaigns(campaigns);
  }
}

function renderTemplate(template, contact) {
  if (!template) return '';
  return template
    .replace(/\{\{firstName\}\}/g, contact.firstName || '')
    .replace(/\{\{lastName\}\}/g, contact.lastName || '')
    .replace(/\{\{fullName\}\}/g, contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim())
    .replace(/\{\{company\}\}/g, contact.company || '')
    .replace(/\{\{title\}\}/g, contact.title || contact.headline || '')
    .replace(/\{\{headline\}\}/g, contact.headline || '');
}

/* ================================================================== */
/*  Campaign alarm                                                    */
/* ================================================================== */

chrome.alarms.create('campaignTick', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'campaignTick') {
    runCampaignTick().catch((err) =>
      console.error('[Campaign tick error]', err)
    );
  }
});

/* ================================================================== */
/*  Mass Unfollow (DOM-based)                                         */
/* ================================================================== */

async function unfollowCount() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) throw new Error('No active tab');
  const tab = tabs[0];

  const followingUrl = 'https://www.linkedin.com/mynetwork/network-manager/people-follow/following/';

  if (!tab.url || !tab.url.includes('people-follow/following')) {
    await chrome.tabs.update(tab.id, { url: followingUrl });
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: () => {
      const buttons = document.querySelectorAll('button[aria-label*="stop following"], button[aria-label*="Stop following"], button[aria-label*="Unfollow"]');
      return buttons.length;
    },
  });

  return { count: results?.[0]?.result || 0 };
}

async function unfollowAll(tabId) {
  const followingUrl = 'https://www.linkedin.com/mynetwork/network-manager/people-follow/following/';

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !tab.url.includes('people-follow/following')) {
    await chrome.tabs.update(tabId, { url: followingUrl });
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  let totalUnfollowed = 0;
  let totalErrors = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async () => {
        const buttons = document.querySelectorAll(
          'button[aria-label*="stop following"], button[aria-label*="Stop following"], button[aria-label*="Unfollow"]'
        );

        if (buttons.length === 0) return { clicked: 0, remaining: 0 };

        let clicked = 0;
        let errors = 0;

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

            const delay = 2000 + Math.random() * 3000;
            await new Promise((r) => setTimeout(r, delay));
          } catch (e) {
            errors++;
          }
        }

        const showMore = document.querySelector(
          'button.scaffold-finite-scroll__load-button, button[aria-label*="Show more"]'
        );
        if (showMore) {
          showMore.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          await new Promise((r) => setTimeout(r, 2000));
        }

        const remaining = document.querySelectorAll(
          'button[aria-label*="stop following"], button[aria-label*="Stop following"], button[aria-label*="Unfollow"]'
        ).length;

        return { clicked, errors, remaining, hasShowMore: !!showMore };
      },
    });

    const data = result?.[0]?.result || { clicked: 0, remaining: 0 };
    totalUnfollowed += data.clicked || 0;
    totalErrors += data.errors || 0;

    chrome.runtime.sendMessage({
      type: 'UNFOLLOW_PROGRESS',
      unfollowed: totalUnfollowed,
      errors: totalErrors,
      remaining: data.remaining || 0,
    }).catch(() => {});

    if ((data.clicked || 0) === 0 && !data.hasShowMore) {
      hasMore = false;
    }

    if (hasMore) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return { ok: true, unfollowed: totalUnfollowed, errors: totalErrors };
}

/* ================================================================== */
/*  Profile & Search exports                                          */
/* ================================================================== */

function extractPublicId(url) {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function exportProfile() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) throw new Error('No active tab');

  const publicId = extractPublicId(tabs[0].url || '');
  if (!publicId) throw new Error('Not on a LinkedIn profile page.');

  const raw = await getProfile(publicId);
  return normalizeProfile(raw);
}

async function searchExport({ keywords, count = 25 }) {
  if (!keywords) throw new Error('Keywords are required for search.');

  const allResults = [];
  let start = 0;
  const pageSize = Math.min(count, 49);

  while (allResults.length < count) {
    const raw = await searchPeople({ keywords, start, count: pageSize });
    const batch = normalizeSearchCluster(raw);

    if (batch.length === 0) break;
    allResults.push(...batch);
    start += pageSize;

    if (allResults.length < count) {
      await humanDelay();
    }
  }

  return allResults.slice(0, count);
}

function profilesToCSV(profiles) {
  if (!profiles.length) return '';

  const headers = [
    'Full Name', 'First Name', 'Last Name', 'Headline', 'Title',
    'Company', 'Location', 'Industry', 'LinkedIn URL', 'Summary', 'Skills',
  ];

  const escapeCSV = (val) => {
    const str = String(val || '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = profiles.map((p) => [
    p.fullName, p.firstName, p.lastName, p.headline, p.title,
    p.company, p.location, p.industry, p.linkedinUrl,
    p.summary, (p.skills || []).join('; '),
  ].map(escapeCSV).join(','));

  return [headers.join(','), ...rows].join('\n');
}

async function downloadCSV(profiles) {
  const csv = profilesToCSV(profiles);
  if (!csv) throw new Error('No data to export.');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const filename = `linkedin_export_${new Date().toISOString().slice(0, 10)}.csv`;

  await chrome.downloads.download({
    url,
    filename,
    saveAs: true,
  });

  setTimeout(() => URL.revokeObjectURL(url), 60000);

  return { ok: true, filename, count: profiles.length };
}

/* ================================================================== */
/*  Message handler                                                   */
/* ================================================================== */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handle(msg) {
  switch (msg.type) {
    /* ---------- Config ---------- */
    case 'GET_CONFIG':
      return getConfig();
    case 'SET_CONFIG':
      return setConfig(msg.config);

    /* ---------- Usage ---------- */
    case 'GET_USAGE':
      return {
        action: await getUsageCounts('action'),
        invite: await getUsageCounts('invite'),
        message: await getUsageCounts('message'),
      };
    case 'GET_QUOTAS': {
      const config = await getConfig();
      return {
        maxPerHour: config.maxPerHour,
        maxInvitesPerDay: config.maxInvitesPerDay,
        maxMessagesPerDay: config.maxMessagesPerDay,
      };
    }

    /* ---------- Unfollow ---------- */
    case 'UNFOLLOW_COUNT':
      return unfollowCount();
    case 'UNFOLLOW_ALL': {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs.length) throw new Error('No active tab');
      return unfollowAll(tabs[0].id);
    }

    /* ---------- Profile ---------- */
    case 'EXPORT_PROFILE':
      return exportProfile();

    /* ---------- Search ---------- */
    case 'SEARCH_EXPORT':
      return searchExport({ keywords: msg.keywords, count: msg.count || 25 });
    case 'DOWNLOAD_CSV':
      return downloadCSV(msg.profiles);

    /* ---------- Invites / Messages ---------- */
    case 'SEND_INVITE': {
      const iq = await checkQuota('invite');
      if (!iq.allowed) throw new Error(iq.reason);
      const result = await sendInvite({
        publicIdentifier: msg.publicIdentifier,
        profileUrn: msg.profileUrn,
        note: msg.note,
      });
      await incrementUsage('invite');
      return result;
    }
    case 'SEND_MESSAGE': {
      const mq = await checkQuota('message');
      if (!mq.allowed) throw new Error(mq.reason);
      const result = await sendMessage({
        recipientUrn: msg.recipientUrn,
        body: msg.body,
        subtype: msg.subtype,
        inmailSubject: msg.inmailSubject,
      });
      await incrementUsage('message');
      return result;
    }

    /* ---------- Campaigns ---------- */
    case 'GET_CAMPAIGNS':
      return getCampaigns();
    case 'CREATE_CAMPAIGN':
      return createCampaign({
        name: msg.name,
        steps: msg.steps,
        contacts: msg.contacts,
      });
    case 'UPDATE_CAMPAIGN_STATUS':
      return updateCampaignStatus(msg.campaignId, msg.status);
    case 'DELETE_CAMPAIGN':
      return deleteCampaign(msg.campaignId);
    case 'RUN_CAMPAIGN_TICK':
      await runCampaignTick();
      return { ok: true };

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
