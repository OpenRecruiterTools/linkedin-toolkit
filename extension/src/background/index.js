/**
 * LinkedIn Toolkit — Background Service Worker (router).
 *
 * Deliberately thin. Every feature module registers its own contract actions
 * on import; this file routes inbound messages through `engine.handle`, owns
 * mass unfollow (which drives the user's own tab and has no API), and wires
 * the alarms.
 *
 * Every inbound message is a contract envelope: { action, params }.
 */

import { ACTIONS, ERROR, EngineError, err } from '../lib/actions.js';
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

import { ensureConnected, onAlarm, startKeepalive } from './bridge.js';

/* ================================================================== */
/*  Quotas and pacing live in quota.js; outreach.js wires the engine's  */
/*  rate-limit provider.                                               */
/* ================================================================== */

export const CAMPAIGN_TICK_ALARM = 'campaignTick';

/* ================================================================== */
/*  Tabs                                                              */
/* ================================================================== */

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) throw new Error('No active tab');
  return tabs[0];
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

/**
 * Mass unfollow is the one action here that drives the user's own visible tab,
 * clicking through their following list a page at a time. It is destructive in
 * a way no quota covers — there is no undo and no queue — and it is not
 * something an agent should ever start on its own initiative. Only the popup,
 * where the person can see the tab it is working in, may run it.
 */
const UNFOLLOW_IS_HUMAN =
  'Mass unfollow runs in your own browser tab and cannot be undone. Run it from the popup.';

function assertPopup(ctx = {}) {
  if (ctx.origin !== 'popup') throw new EngineError(ERROR.UNAUTHORIZED, UNFOLLOW_IS_HUMAN);
}

register(ACTIONS.NETWORK_UNFOLLOW_COUNT, (_params, ctx) => {
  assertPopup(ctx);
  return unfollowCount();
});
register(ACTIONS.NETWORK_UNFOLLOW_ALL, (_params, ctx) => {
  assertPopup(ctx);
  return unfollowAll();
});

/* ================================================================== */
/*  Router                                                            */
/* ================================================================== */

export async function route(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.action !== 'string') {
    return err(null, ERROR.INVALID_PARAMS, 'Message must be { action, params }');
  }
  return handle(msg.action, msg.params || {}, msg.origin || 'popup');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  route(msg)
    .then(sendResponse)
    .catch((e) => sendResponse(err(null, ERROR.INTERNAL, e.message)));
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
