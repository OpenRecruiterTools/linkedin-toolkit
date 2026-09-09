/**
 * Mass unfollow, two ways.
 *
 * **`api` (the default).** LinkedIn *does* have an endpoint for this after
 * all: the Following manager reads the curation-hub search with
 * `resultType: PEOPLE_FOLLOW` and its Unfollow button POSTs a
 * `followingStates` patch. Both were captured from the live client on
 * 2026-09-09 (1.13.46516) and both are in `voyager.js`. Running them directly
 * needs no tab, cannot be broken by a markup change, and is about three times
 * faster than clicking — one POST plus a short pause per person, against a
 * click plus a scroll plus a wait for the button to flip.
 *
 * **`dom` (the fallback).** The original: drive the user's own visible tab,
 * clicking the page the way a person would. It is slower and it is fragile,
 * and it is kept anyway, because the day LinkedIn rotates the query id or
 * changes the patch shape, a page a human can click is the one thing that
 * still works. Pass `mode: 'dom'` to get it.
 *
 * Both are irreversible and both are bulk, which is why the whole module is
 * built around the same rules whichever one is running:
 *
 *   1. **Never more than you asked for.** `limit` stops the run after N
 *      successful unfollows. The popup defaults it to 25 so the first run is
 *      small, and you can set it to 1 and watch what happens to one person.
 *   2. **You can look before you leap.** `dryRun` walks exactly the same list,
 *      by exactly the same route, and returns the names it *would* unfollow
 *      without sending a single write.
 *   3. **Stop at the first sign of trouble.** The DOM run re-reads the tab
 *      between every batch: if it navigated away, was closed, or landed on a
 *      checkpoint page, the run ends there and says so. The API run stands
 *      down on 401/403/429/451 the moment it sees one, and on any other
 *      failure twice in a row.
 *   4. **You can stop it.** `network.unfollowStop` sets a flag both loops
 *      check between people, and the names already done are still reported.
 *
 * No quota bucket is charged for an unfollow. The four buckets meter the
 * things LinkedIn restricts accounts over — invitations, messages, profile
 * views, searches — and unfollowing is none of them: it is you removing your
 * own subscriptions. The challenge latch still applies, because that is not a
 * budget, it is LinkedIn telling us to stop.
 *
 * The DOM half targets one tab id, captured once, so a run can never touch a
 * tab the person did not point it at. Its selectors are aria-label and role
 * based on purpose: LinkedIn's class names are hashed and rotate, and the
 * accessible names do not, because screen readers depend on them.
 *
 * DOM page facts, captured 2026-09-09 against web client 1.13.46516:
 *   - list page  https://www.linkedin.com/mynetwork/network-manager/people-follow/following/
 *   - ~20 rows per page, more appended on scroll
 *   - per row    <button aria-label="Click to stop following Ada Lovelace">Following</button>
 *   - after the click the same button's label toggles to "Click to follow Ada
 *     Lovelace" — that toggle is the success signal, and it is what we wait for
 *   - header     "You are following 785 people out of your network"
 */

import {
  ERROR,
  EVENTS,
  UNFOLLOW_LIMIT_MAX,
  UNFOLLOW_MODE_DEFAULT,
  UNFOLLOW_SAMPLE_MAX,
} from '../lib/actions.js';
import { emit } from './events.js';
import { getFollowing, unfollowProfile } from './voyager.js';

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

/**
 * One POST every 0.8–1.6 seconds in API mode.
 *
 * Faster than the DOM run's 2–5 s, and deliberately so: there is no page to
 * re-render, no scroll to settle and no button to watch, so the only thing the
 * gap is buying is a request rate that does not look like a script. It is
 * still randomised, and still an order of magnitude slower than the endpoint
 * would allow, because a flat interval is its own signature. At 1.2 s average
 * a 735-person list is about fifteen minutes.
 */
export const UNFOLLOW_API_PACING = Object.freeze({
  minDelayMs: 800,
  maxDelayMs: 1600,
});

/**
 * People per list page in API mode.
 *
 * The live client asks for ten. Fifty is the most `voyagerSearchDashClusters`
 * will answer with in one go, and asking for a page every fifty unfollows
 * rather than every ten is fifty fewer reads on a 700-person list.
 */
export const UNFOLLOW_PAGE_SIZE = 50;

/** How often `unfollow_progress` is emitted, in people. */
export const UNFOLLOW_PROGRESS_EVERY = 10;

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
 * `network.unfollowCount` in DOM mode — how many you follow, plus a few names.
 *
 * The count comes from the page header ("You are following 785 people out of
 * your network") because the DOM only ever holds the first page of rows;
 * without the header we fall back to what is loaded and say so by returning
 * the smaller number rather than pretending.
 */
export async function unfollowCountDom() {
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
 * `network.unfollowAll` in DOM mode — click through the tab the popup is on.
 *
 * @param {{limit?: number, dryRun?: boolean}} params
 * @returns {Promise<{unfollowed: number, attempted: number, names: string[],
 *   stopped: 'limit'|'end'|'error'|'cancelled', error?: string}>}
 */
export async function unfollowAllDom(params = {}) {
  const limit = clampLimit(params.limit);
  const dryRun = !!params.dryRun;

  const tab = await ensureFollowingTab(dryRun ? 3000 : 4000);
  const tabId = tab.id;

  const names = [];
  let unfollowed = 0;
  let attempted = 0;
  let stopped = 'end';
  let error = null;

  beginRun(0);
  try {
    ({ unfollowed, attempted, stopped, error } = await sweepBatches({
      tabId,
      limit,
      dryRun,
      names,
    }));
  } finally {
    endRun();
  }

  const out = { unfollowed, attempted, names, stopped };
  if (error) out.error = error;
  return out;
}

/**
 * The DOM run's batch loop, lifted out so the run bookkeeping around it stays
 * readable. Pushes names onto the array it is handed and reports the counts.
 */
async function sweepBatches({ tabId, limit, dryRun, names }) {
  let unfollowed = 0;
  let attempted = 0;
  let stopped = 'end';
  let error = null;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    // Stop is checked between batches rather than between clicks: the clicking
    // happens inside the page, ten at a time, and reaching into it mid-sweep
    // would mean a second injection racing the first.
    if (run.stopRequested) {
      stopped = 'cancelled';
      break;
    }

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
      run.done = unfollowed;
      run.lastName = names.length ? names[names.length - 1] : run.lastName;
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

  return { unfollowed, attempted, stopped, error };
}

/* ================================================================== */
/*  API mode                                                          */
/* ================================================================== */

/**
 * LinkedIn answers that mean "stop now", not "try the next person".
 *
 * `voyagerFetch` has already mapped the status onto a contract code and
 * already told `quota.js` to back off; all this has to decide is whether to
 * carry on. Both the code and the raw status are checked because they answer
 * slightly different questions: 403 comes back as a plain `LINKEDIN_ERROR`
 * (its code says nothing about standing down) while a `CHALLENGE_DETECTED`
 * raised by the latch before the request ever left has no status at all.
 */
const STAND_DOWN_CODES = new Set([
  ERROR.RATE_LIMITED,
  ERROR.CHALLENGE_DETECTED,
  ERROR.NOT_LOGGED_IN,
]);
const STAND_DOWN_STATUS = new Set([401, 403, 429, 451]);

function isStandDown(e) {
  if (!e) return false;
  if (STAND_DOWN_STATUS.has(Number(e.status))) return true;
  return typeof e.code === 'string' && STAND_DOWN_CODES.has(e.code);
}

/** Two failures in a row means something is wrong with us, not with them. */
const CONSECUTIVE_FAILURES_MAX = 2;

/**
 * A list read cannot be trusted to shrink the list forever. 200 pages of 50 is
 * 10,000 people — twice the contract ceiling — so hitting this means the page
 * cursor stopped moving, and the honest thing is to end rather than to spin.
 */
const MAX_API_PAGES = 200;

/**
 * The live state of the one run that may be in flight.
 *
 * Mass unfollow is popup-only and there is one popup, so a second run is a
 * mistake rather than a use case; the flag exists so `network.unfollowStatus`
 * can answer "is anything happening" and so `network.unfollowStop` has
 * something to set.
 */
const run = {
  running: false,
  done: 0,
  total: 0,
  lastName: '',
  stopRequested: false,
};

/** `network.unfollowStatus` — what a progress line needs, and nothing else. */
export function unfollowStatus() {
  return {
    running: run.running,
    done: run.done,
    total: run.total,
    lastName: run.lastName,
  };
}

/**
 * `network.unfollowStop` — ask the run in flight to stop.
 *
 * The flag is only set while something is actually running, so pressing Stop
 * on an idle popup cannot poison the next run. What is already unfollowed
 * stays unfollowed: this stops the loop, it does not undo anything.
 */
export function unfollowStop() {
  if (!run.running) return { stopping: false };
  run.stopRequested = true;
  return { stopping: true };
}

/** Reset the run state and claim the slot. */
function beginRun(total = 0) {
  run.running = true;
  run.done = 0;
  run.total = total;
  run.lastName = '';
  run.stopRequested = false;
}

function endRun() {
  run.running = false;
  run.stopRequested = false;
}

/** The randomised gap between two unfollows. */
function apiPauseMs() {
  const { minDelayMs, maxDelayMs } = UNFOLLOW_API_PACING;
  return minDelayMs + Math.random() * Math.max(0, maxDelayMs - minDelayMs);
}

/** A number a caller can act on, or the ceiling when they asked for nothing. */
function clampLimit(asked) {
  const n = Number(asked);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), UNFOLLOW_LIMIT_MAX) : UNFOLLOW_LIMIT_MAX;
}

/** The best name we have for somebody, never an empty string. */
function nameOf(profile) {
  const name = String((profile && (profile.fullName || profile.publicId)) || '').trim();
  return name || 'Unknown';
}

/** Progress is announced every ten, and never for a preview. */
async function announce(done, total) {
  if (done <= 0 || done % UNFOLLOW_PROGRESS_EVERY !== 0) return;
  try {
    await emit(EVENTS.UNFOLLOW_PROGRESS, { done, total });
  } catch {
    /* a progress line is not worth failing a run over */
  }
}

/**
 * `network.unfollowCount` in API mode — no tab, one request.
 *
 * `totalResultCount` on the list read is the number LinkedIn's own header
 * prints, so this is the same answer the DOM mode goes and reads a page for,
 * without opening anything. The page it asks for is ten people wide because
 * the sample the popup shows is ten, so the names come free.
 */
export async function unfollowCountApi() {
  const page = await getFollowing({ start: 0, count: UNFOLLOW_SAMPLE_MAX });
  const profiles = page.profiles || [];
  const count = Number.isFinite(page.total) ? page.total : profiles.length;
  return { count, sample: profiles.slice(0, UNFOLLOW_SAMPLE_MAX).map(nameOf) };
}

/**
 * `network.unfollowAll` in API mode.
 *
 * Read a page of the following list, unfollow the people on it one at a time
 * with a randomised pause, then read the next page. Two details are worth
 * spelling out:
 *
 * **Paging while the list shrinks.** Every successful unfollow removes a row
 * from the list the *next* read is offset into, so advancing `start` by a full
 * page would step over exactly as many people as were unfollowed. The cursor
 * therefore advances by what stayed — `page length − unfollowed on that page`
 * — and a `seen` set of urns catches whatever that arithmetic still overlaps,
 * so nobody is asked twice and nobody is skipped.
 *
 * **Failures.** A stand-down answer (401/403/429/451) ends the run on the
 * spot; anything else is allowed one retry's worth of doubt and ends the run
 * on the second in a row. A single failure in the middle of 700 is a person
 * whose state LinkedIn would not change, not a reason to abandon the rest.
 *
 * @param {{limit?: number, dryRun?: boolean}} params
 * @returns {Promise<{unfollowed: number, attempted: number, names: string[],
 *   stopped: 'limit'|'end'|'error'|'cancelled', error?: string}>}
 */
export async function unfollowAllApi(params = {}) {
  const limit = clampLimit(params.limit);
  const dryRun = !!params.dryRun;

  const names = [];
  const seen = new Set();
  let unfollowed = 0;
  let attempted = 0;
  // What a preview has walked past, counted separately from `names`: the name
  // list stops at NAME_CAP and the limit must not stop with it.
  let previewed = 0;
  let stopped = 'end';
  let error = null;
  let failures = 0;
  let start = 0;
  let total = 0;

  beginRun(0);

  try {
    pages: for (let page = 0; page < MAX_API_PAGES; page += 1) {
      let batch;
      try {
        // eslint-disable-next-line no-await-in-loop
        batch = await getFollowing({ start, count: UNFOLLOW_PAGE_SIZE });
      } catch (e) {
        stopped = 'error';
        error = e && e.message ? e.message : 'Could not read your following list.';
        break;
      }

      const profiles = batch.profiles || [];
      if (Number.isFinite(batch.total)) {
        total = batch.total;
        run.total = total;
      }
      if (!profiles.length) {
        stopped = 'end';
        break;
      }

      let unfollowedHere = 0;

      for (const profile of profiles) {
        if (run.stopRequested) {
          stopped = 'cancelled';
          break pages;
        }

        const urn = String(profile.urn || '');
        if (!urn || seen.has(urn)) continue;
        seen.add(urn);

        const name = nameOf(profile);

        if (dryRun) {
          previewed += 1;
          if (names.length < NAME_CAP) names.push(name);
          run.done = previewed;
          run.lastName = name;
          if (previewed >= limit) {
            stopped = 'limit';
            break pages;
          }
          continue;
        }

        attempted += 1;
        try {
          // eslint-disable-next-line no-await-in-loop
          await unfollowProfile({ profileUrn: urn });
          unfollowed += 1;
          unfollowedHere += 1;
          failures = 0;
          if (names.length < NAME_CAP) names.push(name);
          run.done = unfollowed;
          run.lastName = name;
          // Announced only on a success, or a failure straight after the tenth
          // would announce the same ten twice.
          // eslint-disable-next-line no-await-in-loop
          await announce(unfollowed, total);
        } catch (e) {
          if (isStandDown(e)) {
            stopped = 'error';
            error = e && e.message ? e.message : 'LinkedIn asked us to stop — stopped there.';
            break pages;
          }
          failures += 1;
          if (failures >= CONSECUTIVE_FAILURES_MAX) {
            stopped = 'error';
            error = `LinkedIn refused two unfollows in a row — stopped there. ${
              (e && e.message) || ''
            }`.trim();
            break pages;
          }
        }

        if (unfollowed >= limit) {
          stopped = 'limit';
          break pages;
        }

        // eslint-disable-next-line no-await-in-loop
        await sleep(apiPauseMs());
      }

      // What is left of this page after the unfollowed rows fell out of it.
      start += Math.max(0, profiles.length - unfollowedHere);
      if (total && start >= total) {
        stopped = 'end';
        break;
      }
    }
  } finally {
    endRun();
  }

  const out = { unfollowed, attempted, names, stopped };
  if (error) out.error = error;
  return out;
}

/* ================================================================== */
/*  Dispatch                                                          */
/* ================================================================== */

const isDom = (params) => (params && params.mode ? params.mode : UNFOLLOW_MODE_DEFAULT) === 'dom';

/** `network.unfollowCount` — API unless the caller asked for `mode: 'dom'`. */
export async function unfollowCount(params = {}) {
  return isDom(params) ? unfollowCountDom() : unfollowCountApi();
}

/** `network.unfollowAll` — API unless the caller asked for `mode: 'dom'`. */
export async function unfollowAll(params = {}) {
  return isDom(params) ? unfollowAllDom(params) : unfollowAllApi(params);
}
