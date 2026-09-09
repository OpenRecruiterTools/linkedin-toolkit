/**
 * Mass unfollow — the one action that drives the user's own visible tab.
 *
 * There is no Voyager endpoint for unfollowing from the "Following" manager,
 * so this clicks the page, the way a person would, in the tab the popup is
 * looking at. That makes it the most dangerous thing in the toolkit: it is
 * irreversible, it is bulk, and LinkedIn's markup is obfuscated and changes.
 * So the whole module is built around three rules:
 *
 *   1. **Never more than you asked for.** `limit` stops the run after N
 *      successful unfollows. The popup defaults it to 25 so the first run is
 *      small, and you can set it to 1 and watch what happens to one person.
 *   2. **You can look before you leap.** `dryRun` walks exactly the same list,
 *      by exactly the same selectors, and returns the names it *would*
 *      unfollow without dispatching a single event.
 *   3. **Stop at the first sign of trouble.** Between every batch the worker
 *      re-reads the tab: if it navigated away, was closed, or landed on a
 *      checkpoint/challenge page, the run ends there and says so. The
 *      in-page sweep checks the same thing before every click.
 *
 * Everything targets one tab id, captured once, so a run can never touch a
 * tab the person did not point it at.
 *
 * Selectors are aria-label and role based on purpose. LinkedIn's class names
 * are hashed and rotate; the accessible names do not, because screen readers
 * depend on them.
 *
 * Captured 2026-09-09 against web client 1.13.46516:
 *   - list page  https://www.linkedin.com/mynetwork/network-manager/people-follow/following/
 *   - ~20 rows per page, more appended on scroll
 *   - per row    <button aria-label="Click to stop following Ada Lovelace">Following</button>
 *   - after the click the same button's label toggles to "Click to follow Ada
 *     Lovelace" — that toggle is the success signal, and it is what we wait for
 *   - header     "You are following 785 people out of your network"
 */

import {
  UNFOLLOW_LIMIT_MAX,
  UNFOLLOW_SAMPLE_MAX,
} from '../lib/actions.js';

/* ================================================================== */
/*  Page facts                                                        */
/* ================================================================== */

export const FOLLOWING_URL =
  'https://www.linkedin.com/mynetwork/network-manager/people-follow/following/';

/** How we know a tab is still on the following list. */
export const FOLLOWING_PATH = 'people-follow/following';

/**
 * The per-row toggle, by accessible name.
 *
 * The first alternative is the live 2026 markup; the rest are older wordings
 * kept because they cost nothing and a stale selector here means a silent
 * no-op rather than a visible error.
 */
export const UNFOLLOW_SELECTOR = [
  'button[aria-label^="Click to stop following"]',
  'button[aria-label*="stop following"]',
  'button[aria-label*="Stop following"]',
  'button[aria-label*="Unfollow"]',
  'button[aria-label*="unfollow"]',
].join(', ');

/** The same button after it has flipped — how we know the click landed. */
export const FOLLOW_BACK_SELECTOR = [
  'button[aria-label^="Click to follow"]',
  'button[aria-label^="Follow "]',
].join(', ');

/** Prefixes stripped off an aria-label to leave the person's name. */
export const NAME_PREFIXES = [
  'Click to stop following',
  'Stop following',
  'Unfollow',
  'Click to unfollow',
];

/** The header line that carries the real total, not just the loaded rows. */
export const TOTAL_RE = /following\s+([\d,.\s]+?)\s+people/i;

/** URLs that mean LinkedIn has interrupted us. */
export const CHALLENGE_URL_RE =
  /\/checkpoint\/|\/authwall|\/uas\/login|\/legal\/451|\/error\/451|status=451/i;

/** Page text that means the same thing when the URL has not changed. */
export const CHALLENGE_TEXT_RE =
  /unusual activity|verify (?:it'?s|its) you|security verification|temporarily restricted|your account has been restricted|451: unavailable|solve this puzzle|are you a human/i;

/* ================================================================== */
/*  Pacing                                                            */
/* ================================================================== */

/**
 * One click every 2–5 seconds, as before. This is not politeness theatre: a
 * burst of clicks is exactly the signature LinkedIn restricts accounts for.
 */
export const UNFOLLOW_PACING = Object.freeze({
  minDelayMs: 2000,
  maxDelayMs: 5000,
  /** Between the synthetic mousedown/mouseup/click of one press. */
  pressGapMs: 50,
  /** How long to wait for the button's label to flip before calling it a miss. */
  confirmMs: 3000,
  /** How long a scroll gets to append the next page of rows. */
  settleMs: 1500,
});

/** Clicks per `executeScript` call, so the worker can re-check the tab often. */
export const UNFOLLOW_BATCH = 10;

/** Between batches, back in the worker. */
export const BETWEEN_BATCH_MS = 2000;

/** A run cannot loop forever even if the page lies to us. */
const MAX_PASSES = 1200;

/** Scroll attempts before we accept that the list has ended. */
const MAX_SCROLLS = 400;

/** Names we carry back. A 5,000-name array is nobody's idea of a result. */
export const NAME_CAP = 500;

/* ================================================================== */
/*  Injected page functions                                           */
/* ================================================================== */
/*                                                                    */
/*  These two are serialised by `chrome.scripting.executeScript` and   */
/*  re-parsed inside the page, so they may not close over anything in  */
/*  this module. Every constant they need arrives in `args`. That is   */
/*  also what makes them testable: they are ordinary functions of a    */
/*  document, and the tests run them against a jsdom fixture.          */
/*                                                                    */
/* ================================================================== */

/**
 * Read the list without touching it: the header total, the loaded row count,
 * and the first few accessible names.
 *
 * @param {{selector: string, totalPattern: string, sampleMax: number}} options
 * @returns {{count: number, loaded: number, total: number|null, labels: string[]}}
 */
export function unfollowScan(options) {
  const opts = options || {};
  const buttons = Array.from(document.querySelectorAll(opts.selector));
  const labels = [];
  for (const button of buttons.slice(0, opts.sampleMax || 10)) {
    labels.push(button.getAttribute('aria-label') || (button.textContent || '').trim());
  }

  // The header knows the whole number; the DOM only knows the first page.
  let total = null;
  const body = document.body;
  // `innerText` is what a person sees; `textContent` is the fallback for any
  // engine that does not implement it (jsdom, in the tests).
  const text = body ? body.innerText || body.textContent || '' : '';
  const match = text.match(new RegExp(opts.totalPattern, 'i'));
  if (match && match[1]) {
    const digits = match[1].replace(/[^\d]/g, '');
    if (digits) total = Number(digits);
  }

  return {
    count: total === null ? buttons.length : total,
    loaded: buttons.length,
    total,
    labels,
  };
}

/**
 * Walk the following list, optionally clicking.
 *
 * Returns after `batchMax` presses (or as soon as `limit` is reached, or the
 * list runs out) so the worker gets a chance to re-check the tab. A dry run
 * has nothing to pace, so it walks the whole list in one go.
 *
 * @param {object} options every constant it needs, passed in by the worker
 * @returns {Promise<{unfollowed: number, attempted: number, labels: string[],
 *   remaining: number, hasMore: boolean, challenge: boolean, error: string|null}>}
 */
export async function unfollowSweep(options) {
  const opts = options || {};
  const selector = opts.selector;
  const followBack = opts.followBackSelector || null;
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : Infinity;
  const dryRun = !!opts.dryRun;
  const batchMax = typeof opts.batchMax === 'number' ? opts.batchMax : 10;
  const minDelayMs = typeof opts.minDelayMs === 'number' ? opts.minDelayMs : 2000;
  const maxDelayMs = typeof opts.maxDelayMs === 'number' ? opts.maxDelayMs : 5000;
  const pressGapMs = typeof opts.pressGapMs === 'number' ? opts.pressGapMs : 50;
  const confirmMs = typeof opts.confirmMs === 'number' ? opts.confirmMs : 3000;
  const settleMs = typeof opts.settleMs === 'number' ? opts.settleMs : 1500;
  const maxScrolls = typeof opts.maxScrolls === 'number' ? opts.maxScrolls : 400;
  const challengeUrl = new RegExp(opts.challengeUrlPattern, 'i');
  const challengeText = new RegExp(opts.challengeTextPattern, 'i');

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Non-null when LinkedIn has stopped being the following page. */
  const interrupted = () => {
    const href = String((document.location && document.location.href) || '');
    if (challengeUrl.test(href)) return `LinkedIn interrupted with a checkpoint page (${href})`;
    const body = document.body;
    const text = body ? body.innerText || body.textContent || '' : '';
    if (challengeText.test(text.slice(0, 4000))) {
      return 'LinkedIn showed a verification or restriction page';
    }
    return null;
  };

  const labelOf = (button) => {
    const label = button.getAttribute('aria-label');
    if (label) return label;
    // No accessible name (markup drifted): fall back to the row's own link.
    let row = button.parentElement;
    for (let up = 0; up < 6 && row; up += 1) {
      const link = row.querySelector('a[href*="/in/"], a[href*="/company/"], a[href*="/school/"]');
      if (link && link.textContent && link.textContent.trim()) {
        return link.textContent.trim().split('\n')[0].trim();
      }
      row = row.parentElement;
    }
    return (button.textContent || '').trim();
  };

  const pending = () => Array.from(document.querySelectorAll(selector));

  /** Ask the page for more rows. Returns true when the list actually grew. */
  const loadMore = async () => {
    const before = document.querySelectorAll(selector).length;
    const button =
      document.querySelector('button.scaffold-finite-scroll__load-button') ||
      Array.from(document.querySelectorAll('button')).find((candidate) => {
        const label = `${candidate.getAttribute('aria-label') || ''} ${candidate.textContent || ''}`;
        return /show more|load more/i.test(label);
      });
    if (button) {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } else if (typeof window.scrollTo === 'function') {
      const height = Math.max(
        (document.body && document.body.scrollHeight) || 0,
        (document.documentElement && document.documentElement.scrollHeight) || 0,
      );
      window.scrollTo(0, height);
      window.dispatchEvent(new Event('scroll'));
    }
    await sleep(settleMs);
    return document.querySelectorAll(selector).length > before;
  };

  const handled = new WeakSet();
  const labels = [];
  let unfollowed = 0;
  let attempted = 0;
  let scrolls = 0;
  let exhausted = false;

  const stop = (error) => ({
    unfollowed,
    attempted,
    labels,
    remaining: document.querySelectorAll(selector).length,
    hasMore: false,
    challenge: true,
    error,
  });

  /* ---- Dry run: read the whole list, click nothing ---------------- */

  if (dryRun) {
    while (labels.length < limit) {
      const trouble = interrupted();
      if (trouble) return stop(trouble);

      const fresh = pending().filter((button) => !handled.has(button));
      if (fresh.length) {
        for (const button of fresh) {
          handled.add(button);
          labels.push(labelOf(button));
          if (labels.length >= limit) break;
        }
        continue;
      }

      if (scrolls >= maxScrolls) break;
      scrolls += 1;
      // eslint-disable-next-line no-await-in-loop
      if (!(await loadMore())) {
        exhausted = true;
        break;
      }
    }

    return {
      unfollowed: 0,
      attempted: 0,
      labels,
      remaining: document.querySelectorAll(selector).length,
      hasMore: !exhausted,
      challenge: false,
      error: null,
    };
  }

  /* ---- The real thing --------------------------------------------- */

  while (unfollowed < limit && attempted < batchMax) {
    const trouble = interrupted();
    if (trouble) return stop(trouble);

    const fresh = pending().filter((button) => !handled.has(button));
    if (!fresh.length) {
      if (scrolls >= maxScrolls) {
        exhausted = true;
        break;
      }
      scrolls += 1;
      // eslint-disable-next-line no-await-in-loop
      if (!(await loadMore())) {
        exhausted = true;
        break;
      }
      continue;
    }

    const button = fresh[0];
    handled.add(button);
    attempted += 1;
    const label = labelOf(button);

    try {
      if (typeof button.scrollIntoView === 'function') {
        button.scrollIntoView({ block: 'center' });
      }
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      // eslint-disable-next-line no-await-in-loop
      await sleep(pressGapMs);
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      // eslint-disable-next-line no-await-in-loop
      await sleep(pressGapMs);
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // Success is the label flipping to "Click to follow …", or the row
      // leaving the list entirely. Poll for it rather than assuming.
      let confirmed = false;
      const deadline = Date.now() + confirmMs;
      do {
        confirmed =
          !button.isConnected ||
          (followBack ? button.matches(followBack) : false) ||
          !button.matches(selector);
        if (confirmed) break;
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.min(100, confirmMs));
      } while (Date.now() < deadline);

      if (confirmed) {
        unfollowed += 1;
        labels.push(label);
      }
    } catch {
      // Counted in `attempted`; the caller sees the shortfall.
    }

    if (unfollowed < limit && attempted < batchMax) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(minDelayMs + Math.random() * Math.max(0, maxDelayMs - minDelayMs));
    }
  }

  // `hasMore` is "we did not prove the list had ended", not "rows are still on
  // screen": the last visible row can be unfollowed and another page still be
  // one scroll away. Only a scroll that appends nothing settles it, and the
  // worker's next pass is what asks.
  return {
    unfollowed,
    attempted,
    labels,
    remaining: document.querySelectorAll(selector).length,
    hasMore: !exhausted,
    challenge: false,
    error: null,
  };
}

/* ================================================================== */
/*  Worker side                                                       */
/* ================================================================== */

/** "Click to stop following Ada Lovelace" → "Ada Lovelace". */
export function nameFromLabel(label) {
  const text = String(label || '').trim();
  if (!text) return 'Unknown';
  for (const prefix of NAME_PREFIXES) {
    if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
      const name = text.slice(prefix.length).trim();
      if (name) return name;
    }
  }
  return text;
}

/* ---- Injectable sleep (tests replace it; production waits for real) ---- */

let sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setSleepFn(fn) {
  sleepFn = typeof fn === 'function' ? fn : (ms) => new Promise((r) => setTimeout(r, ms));
}

const sleep = (ms) => sleepFn(ms);

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) throw new Error('No active tab');
  return tabs[0];
}

/**
 * The tab this run is allowed to touch — the active one, put on the following
 * list if it is not there already. Its id is captured once and never
 * re-resolved, so switching tabs mid-run cannot redirect the clicks.
 */
export async function ensureFollowingTab(waitMs) {
  const tab = await activeTab();
  if (!tab.url || !tab.url.includes(FOLLOWING_PATH)) {
    await chrome.tabs.update(tab.id, { url: FOLLOWING_URL });
    await sleep(waitMs);
  }
  return tab;
}

/**
 * Is the tab we started on still the tab we are entitled to click?
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function checkTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    tab = null;
  }
  if (!tab) return { ok: false, reason: 'The LinkedIn tab was closed — stopped there.' };

  const url = tab.url || tab.pendingUrl || '';
  if (CHALLENGE_URL_RE.test(url)) {
    return { ok: false, reason: `LinkedIn interrupted with a checkpoint page — stopped there.` };
  }
  if (!url.includes(FOLLOWING_PATH)) {
    return {
      ok: false,
      reason: 'The tab moved away from your Following list — stopped there.',
    };
  }
  return { ok: true };
}

/**
 * `network.unfollowCount` — how many people you follow, plus a few names.
 *
 * The count comes from the page header ("You are following 785 people out of
 * your network") because the DOM only ever holds the first page of rows;
 * without the header we fall back to what is loaded and say so by returning
 * the smaller number rather than pretending.
 */
export async function unfollowCount() {
  const tab = await ensureFollowingTab(3000);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    args: [
      {
        selector: UNFOLLOW_SELECTOR,
        totalPattern: TOTAL_RE.source,
        sampleMax: UNFOLLOW_SAMPLE_MAX,
      },
    ],
    func: unfollowScan,
  });

  const data = results && results[0] ? results[0].result : null;

  // Older builds of this action resolved to a bare number.
  if (typeof data === 'number') return { count: data, sample: [] };
  if (!data) return { count: 0, sample: [] };

  const sample = (data.labels || []).map(nameFromLabel).slice(0, UNFOLLOW_SAMPLE_MAX);
  return { count: Number(data.count) || 0, sample };
}

/**
 * `network.unfollowAll` — unfollow up to `limit` people, or preview who.
 *
 * @param {{limit?: number, dryRun?: boolean}} params
 * @returns {Promise<{unfollowed: number, attempted: number, names: string[],
 *   stopped: 'limit'|'end'|'error', error?: string}>}
 */
export async function unfollowAll(params = {}) {
  const asked = Number(params.limit);
  const limit =
    Number.isFinite(asked) && asked > 0
      ? Math.min(Math.floor(asked), UNFOLLOW_LIMIT_MAX)
      : UNFOLLOW_LIMIT_MAX;
  const dryRun = !!params.dryRun;

  const tab = await ensureFollowingTab(dryRun ? 3000 : 4000);
  const tabId = tab.id;

  const names = [];
  let unfollowed = 0;
  let attempted = 0;
  let stopped = 'end';
  let error = null;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    // Between every batch: is this still the tab, and is it still the page?
    // eslint-disable-next-line no-await-in-loop
    const tabState = await checkTab(tabId);
    if (!tabState.ok) {
      stopped = 'error';
      error = tabState.reason;
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [
        {
          selector: UNFOLLOW_SELECTOR,
          followBackSelector: FOLLOW_BACK_SELECTOR,
          limit: limit - unfollowed,
          dryRun,
          batchMax: UNFOLLOW_BATCH,
          maxScrolls: MAX_SCROLLS,
          challengeUrlPattern: CHALLENGE_URL_RE.source,
          challengeTextPattern: CHALLENGE_TEXT_RE.source,
          ...UNFOLLOW_PACING,
        },
      ],
      func: unfollowSweep,
    });

    const data = results && results[0] ? results[0].result : null;
    if (!data) {
      stopped = 'error';
      error = 'The LinkedIn tab did not answer — stopped there.';
      break;
    }

    unfollowed += data.unfollowed || 0;
    attempted += data.attempted || 0;
    for (const label of data.labels || []) {
      if (names.length < NAME_CAP) names.push(nameFromLabel(label));
    }

    if (!dryRun) {
      Promise.resolve(
        chrome.runtime.sendMessage({
          type: 'UNFOLLOW_PROGRESS',
          unfollowed,
          attempted,
          remaining: data.remaining || 0,
        }),
      ).catch(() => {});
    }

    if (data.challenge) {
      stopped = 'error';
      error = data.error || 'LinkedIn interrupted the run — stopped there.';
      break;
    }
    if (dryRun) {
      stopped = names.length >= limit ? 'limit' : 'end';
      break;
    }
    if (unfollowed >= limit) {
      stopped = 'limit';
      break;
    }
    if (!data.hasMore) {
      stopped = 'end';
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(BETWEEN_BATCH_MS);
  }

  const out = { unfollowed, attempted, names, stopped };
  if (error) out.error = error;
  return out;
}
