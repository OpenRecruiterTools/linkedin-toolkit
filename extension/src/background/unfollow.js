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
 * **Two lists, not one.** LinkedIn's Following list does not include your
 * connections: you are made to follow everybody you connect with, and you go
 * on following them after that list has been emptied to zero, which is why a
 * feed that should be silent is still full of posts. `scope: 'everyone'` adds
 * a second source — a page-by-page scan of your *followers*, the only read
 * that says whether you still follow somebody — and the limit, the Stop flag,
 * the seen set, the failure counter and the challenge latch all carry across
 * both of them.
 *
 * **One stream or three.** `speed: 'careful'` (the default) is one request at
 * a time. `speed: 'fast'` is three streams over the same queue and the same
 * limit slots, each with its own 0.5–0.9 s gap — about four unfollows a
 * second, and correspondingly more likely to be the thing LinkedIn notices. A
 * stand-down answer on any one stream ends all three.
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
  UNFOLLOW_PHASE_SCANNING,
  UNFOLLOW_SAMPLE_MAX,
} from '../lib/actions.js';
import { emit } from './events.js';
import {
  FOLLOWERS_PAGE_SIZE,
  getFollowersFollowing,
  getFollowing,
  unfollowProfile,
} from './voyager.js';

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
 * One POST every 0.5–0.9 seconds *per stream*, in `speed: 'fast'`.
 *
 * Three streams at that gap is roughly four unfollows a second — several times
 * quicker than the careful path, and several times more likely to be the thing
 * LinkedIn rate-limits. It is still randomised and still gapped; it is simply
 * far less patient, which is why the popup makes you tick a box that says so.
 */
export const UNFOLLOW_FAST_PACING = Object.freeze({
  minDelayMs: 500,
  maxDelayMs: 900,
});

/** How many streams `speed: 'fast'` runs. Three, and not a knob. */
export const UNFOLLOW_FAST_STREAMS = 3;

/**
 * One followers page every 0.4–0.8 seconds, randomised.
 *
 * Reading is cheaper than writing and the followers list is the long one —
 * 9,479 followers is 190 pages — so the gap between reads is half the gap
 * between unfollows. It is still a gap: the scan never bursts.
 */
export const UNFOLLOW_SCAN_PACING = Object.freeze({
  minDelayMs: 400,
  maxDelayMs: 800,
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
 * Followers pages read before we accept that list has ended.
 *
 * Fifty a page, so this is 50,000 followers — well past any account this was
 * built for, and a hard stop rather than a scan that could run all day.
 */
const MAX_SCAN_PAGES = 1000;

/**
 * The live state of the one run that may be in flight.
 *
 * Mass unfollow is popup-only and there is one popup, so a second run is a
 * mistake rather than a use case; `running` exists so `network.unfollowStatus`
 * can answer "is anything happening" and so `network.unfollowStop` has
 * something to set. Everything below it is the bookkeeping the streams share —
 * one bag, because one run at a time is the invariant this module is built on.
 */
const run = {
  running: false,
  done: 0,
  total: 0,
  lastName: '',
  stopRequested: false,

  /* ---- what the streams share ------------------------------------- */

  limit: UNFOLLOW_LIMIT_MAX,
  dryRun: false,
  names: [],
  /** Profile urns already claimed, so nobody is handled twice. */
  seen: new Set(),
  unfollowed: 0,
  attempted: 0,
  /** What a preview has walked past; `names` stops at NAME_CAP, this does not. */
  previewed: 0,
  /** Slots taken out of `limit`, held from before a POST until it fails. */
  claimed: 0,
  /** Set by a stream that found the run's slots gone; read by `drain`. */
  limitReached: false,
  failures: 0,
  followingTotal: null,
  ending: false,
  stopped: 'end',
  error: null,

  /* ---- the followers scan ----------------------------------------- */

  /** `'scanning'` while the followers list is being read, `''` otherwise. */
  phase: '',
  scanned: 0,
  scannedTotal: 0,
  /** Followers turned up so far whose own state still says we follow them. */
  stillFollowing: 0,
};

/**
 * `network.unfollowStatus` — what a progress line needs, and nothing else.
 *
 * The last three appear only while the followers list is being read, which is
 * the one thing `done` cannot say: a scan can read a thousand followers and
 * unfollow none of them. A run that never scans answers exactly what it always
 * answered.
 */
export function unfollowStatus() {
  const status = {
    running: run.running,
    done: run.done,
    total: run.total,
    lastName: run.lastName,
  };
  if (run.phase === UNFOLLOW_PHASE_SCANNING) {
    status.phase = run.phase;
    status.scanned = run.scanned;
    status.scannedTotal = run.scannedTotal;
  }
  return status;
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

  run.limit = UNFOLLOW_LIMIT_MAX;
  run.dryRun = false;
  run.names = [];
  run.seen = new Set();
  run.unfollowed = 0;
  run.attempted = 0;
  run.previewed = 0;
  run.claimed = 0;
  run.limitReached = false;
  run.failures = 0;
  run.followingTotal = null;
  run.ending = false;
  run.stopped = 'end';
  run.error = null;

  run.phase = '';
  run.scanned = 0;
  run.scannedTotal = 0;
  run.stillFollowing = 0;
}

function endRun() {
  run.running = false;
  run.stopRequested = false;
  run.phase = '';
}

/** The randomised gap between two unfollows on one stream. */
function apiPauseMs(pacing = UNFOLLOW_API_PACING) {
  const { minDelayMs, maxDelayMs } = pacing;
  return minDelayMs + Math.random() * Math.max(0, maxDelayMs - minDelayMs);
}

/** The randomised gap between two followers pages. */
function scanPauseMs() {
  return apiPauseMs(UNFOLLOW_SCAN_PACING);
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

/**
 * How many people the run is working towards: the Following list's own total,
 * plus every still-followed follower the scan has turned up. It grows during
 * the scan, because until a followers page has been read nobody knows what is
 * on it.
 */
function totalOf() {
  return (run.followingTotal || 0) + run.stillFollowing;
}

/** Progress is announced every ten unfollows, and never for a preview. */
async function announce(done, total) {
  if (done <= 0 || done % UNFOLLOW_PROGRESS_EVERY !== 0) return;
  try {
    await emit(EVENTS.UNFOLLOW_PROGRESS, { done, total });
  } catch {
    /* a progress line is not worth failing a run over */
  }
}

/**
 * Progress for the scan, which is a different question: not "how many have
 * been unfollowed" but "how far through your followers are we". It carries
 * `phase: 'scanning'` so a reader cannot mistake one for the other, and it is
 * sent once per page rather than once per ten people, because a page of fifty
 * followers can contain nobody to unfollow at all.
 */
async function announceScan() {
  try {
    await emit(EVENTS.UNFOLLOW_PROGRESS, {
      done: run.scanned,
      total: run.scannedTotal,
      phase: UNFOLLOW_PHASE_SCANNING,
    });
  } catch {
    /* as above */
  }
}

/* ------------------------------------------------------------------ */
/*  The bookkeeping every stream shares                                */
/* ------------------------------------------------------------------ */

/**
 * End the run, once.
 *
 * The first reason wins: a 429 on one stream is what the run reports, even
 * though the two streams beside it notice a moment later that the run is
 * ending. `run.ending` is what every stream and every queue watches, and it is
 * separate from the Stop flag so that finishing one source cleanly does not
 * look like somebody pressed Stop.
 */
function stopWith(how, error) {
  if (run.ending) return;
  run.ending = true;
  run.stopped = how;
  if (error) run.error = error;
}

/**
 * Take one of the run's `limit` slots, or refuse.
 *
 * A stream claims its slot *before* it sends anything, which is what keeps
 * three streams from between them overshooting a limit of five. The slot is
 * handed back when the attempt does not land, because the limit counts
 * unfollows, not attempts.
 */
function claimSlot() {
  if (run.claimed >= run.limit) return false;
  run.claimed += 1;
  return true;
}

function releaseSlot() {
  run.claimed -= 1;
}

/**
 * The people on this page the run has not already claimed, marked as claimed.
 *
 * One `seen` set for the whole run: no two streams get the same person, and
 * nobody the Following list already covered is touched again when the
 * followers scan turns them up.
 */
function claimUnseen(profiles) {
  const fresh = [];
  for (const profile of profiles) {
    const urn = String(profile.urn || '');
    if (!urn || run.seen.has(urn)) continue;
    run.seen.add(urn);
    fresh.push({ urn, name: nameOf(profile), following: profile.following });
  }
  return fresh;
}

/* ------------------------------------------------------------------ */
/*  The queue the streams pull from                                    */
/* ------------------------------------------------------------------ */

/**
 * A queue of people, shared by every stream in the run, that refills itself
 * one page at a time.
 *
 * `readPage(start)` does the list-specific part — fetch, claim, decide where
 * the next page starts — and the queue does the paging, the end-of-list
 * bookkeeping and the mutual exclusion that stops three streams fetching the
 * same page three times: whoever finds the buffer empty fetches, and the
 * others wait on that same request.
 *
 * `maxPages` is the backstop: however a list misbehaves, a run reads a bounded
 * number of pages rather than going round for ever.
 *
 * @param {(start: number) => Promise<{people?: object[], nextStart?: number,
 *   ended?: boolean, stop?: boolean}>} readPage
 * @param {number} maxPages
 */
function pageQueue(readPage, maxPages) {
  const buffer = [];
  let start = 0;
  let pages = 0;
  let ended = false;
  let filling = null;

  const fill = () => {
    if (!filling) {
      pages += 1;
      if (pages > maxPages) {
        ended = true;
        return Promise.resolve();
      }
      filling = readPage(start)
        .then((page) => {
          if (page.stop) {
            ended = true;
            return;
          }
          buffer.push(...(page.people || []));
          if (page.nextStart !== undefined) start = page.nextStart;
          if (page.ended) ended = true;
        })
        .finally(() => {
          filling = null;
        });
    }
    return filling;
  };

  return {
    /** The next person, or `null` when there is no next person. */
    async next() {
      for (;;) {
        if (run.ending) return null;
        if (buffer.length) return buffer.shift();
        if (ended) return null;
        // eslint-disable-next-line no-await-in-loop
        await fill();
      }
    },
  };
}

/**
 * Source one: LinkedIn's own Following list.
 *
 * **Paging while the list shrinks.** Every successful unfollow removes a row
 * from the list the *next* read is offset into, so a cursor that advanced by a
 * full page would step over exactly as many people as were unfollowed. It
 * therefore stays where it is while people are still being found, and only
 * moves on for a preview (which removes nobody) or for a page that turned up
 * nobody new — which is also what stops a page of failed unfollows being read
 * round and round. The `seen` set catches whatever that still overlaps.
 */
function followingQueue() {
  return pageQueue(async (start) => {
    let batch;
    try {
      batch = await getFollowing({ start, count: UNFOLLOW_PAGE_SIZE });
    } catch (e) {
      stopWith('error', (e && e.message) || 'Could not read your following list.');
      return { stop: true };
    }

    const profiles = batch.profiles || [];
    if (Number.isFinite(batch.total)) {
      run.followingTotal = batch.total;
      run.total = totalOf();
    }
    if (!profiles.length) return { ended: true };

    const people = claimUnseen(profiles);
    // Advance by what actually came back, never by what was asked for:
    // LinkedIn is under no obligation to answer with a full page.
    const nextStart = run.dryRun || !people.length ? start + profiles.length : start;
    return {
      people,
      nextStart,
      ended: run.followingTotal !== null && nextStart >= run.followingTotal,
    };
  }, MAX_API_PAGES);
}

/**
 * Source two: our followers, which is where our connections are.
 *
 * It always pages forward — unfollowing somebody does not stop them following
 * us, so nothing is removed underneath the cursor — and hands on only the rows
 * whose own `FollowingState` still says we follow them. Reading is what takes
 * the time here (9,479 followers is 190 pages), so each page waits its own
 * 0.4–0.8 s and then says how far the scan has got.
 */
function followersQueue() {
  let read = 0;
  return pageQueue(async (start) => {
    // Every page but the first waits first: a scan that bursts through 190
    // reads looks exactly like the thing LinkedIn restricts accounts for.
    if (read) await sleep(scanPauseMs());
    read += 1;

    let batch;
    try {
      batch = await getFollowersFollowing({ start, count: FOLLOWERS_PAGE_SIZE });
    } catch (e) {
      stopWith('error', (e && e.message) || 'Could not read your followers list.');
      return { stop: true };
    }

    const profiles = batch.profiles || [];
    if (Number.isFinite(batch.total)) run.scannedTotal = batch.total;
    if (!profiles.length) return { ended: true };

    run.scanned += profiles.length;
    const people = claimUnseen(profiles).filter((person) => person.following === true);
    run.stillFollowing += people.length;
    run.total = totalOf();
    await announceScan();

    const nextStart = start + profiles.length;
    return {
      people,
      nextStart,
      ended: run.scannedTotal > 0 && nextStart >= run.scannedTotal,
    };
  }, MAX_SCAN_PAGES);
}

/* ------------------------------------------------------------------ */
/*  One stream                                                         */
/* ------------------------------------------------------------------ */

/**
 * One POST, and every reason it could end the run.
 *
 * @returns {Promise<boolean>} false when this stream must stop
 */
async function unfollowOne(person) {
  run.attempted += 1;
  try {
    await unfollowProfile({ profileUrn: person.urn });
  } catch (e) {
    if (isStandDown(e)) {
      stopWith('error', (e && e.message) || 'LinkedIn asked us to stop — stopped there.');
      return false;
    }
    // It did not land, so it does not spend one of the run's slots.
    releaseSlot();
    run.failures += 1;
    if (run.failures >= CONSECUTIVE_FAILURES_MAX) {
      stopWith(
        'error',
        `LinkedIn refused two unfollows in a row — stopped there. ${(e && e.message) || ''}`.trim(),
      );
      return false;
    }
    return true;
  }

  run.failures = 0;
  run.unfollowed += 1;
  if (run.names.length < NAME_CAP) run.names.push(person.name);
  run.done = run.unfollowed;
  run.lastName = person.name;
  // Announced only on a success, or a failure straight after the tenth would
  // announce the same ten twice.
  await announce(run.unfollowed, run.total);
  return true;
}

/**
 * One stream: claim a slot, take the next person, unfollow, pause, repeat.
 *
 * A careful run is one of these. A fast run is three of them over the same
 * queue and the same slots, so the limit, the stop flag, the `seen` set and
 * the failure counter are shared rather than multiplied by three.
 */
async function stream(queue, pacing) {
  for (;;) {
    if (run.ending) return;
    if (run.stopRequested) {
      stopWith('cancelled');
      return;
    }
    if (!claimSlot()) {
      // Not `stopWith('limit')`: with three streams the two that find the
      // slots gone would end the run before the one holding the last slot had
      // sent anything. Whether the limit is the reason the run ended is a
      // question only `drain` can answer, once every stream has come back.
      run.limitReached = true;
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    const person = await queue.next();
    if (!person) {
      releaseSlot();
      stopWith('end');
      return;
    }
    if (run.stopRequested) {
      releaseSlot();
      stopWith('cancelled');
      return;
    }

    if (run.dryRun) {
      run.previewed += 1;
      if (run.names.length < NAME_CAP) run.names.push(person.name);
      run.done = run.previewed;
      run.lastName = person.name;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const carryOn = await unfollowOne(person);
    if (!carryOn) return;

    if (run.claimed < run.limit) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(apiPauseMs(pacing));
    }
  }
}

/** Work one source dry with `streams` streams, then come back. */
async function drain(queue, streams, pacing) {
  run.ending = false;
  run.limitReached = false;
  await Promise.all(Array.from({ length: streams }, () => stream(queue, pacing)));
  // Every other way out of a stream ends the run as it goes, so an unended run
  // here means every stream stopped for want of a slot.
  if (!run.ending && run.limitReached) stopWith('limit');
}

/* ------------------------------------------------------------------ */
/*  The two actions                                                    */
/* ------------------------------------------------------------------ */

/**
 * `network.unfollowCount` in API mode — no tab, and usually one request.
 *
 * `totalResultCount` on the list read is the number LinkedIn's own header
 * prints, so this is the same answer the DOM mode goes and reads a page for,
 * without opening anything. The page it asks for is ten people wide because
 * the sample the popup shows is ten, so the names come free.
 *
 * With `scope: 'everyone'` it also reads the whole followers list, fifty at a
 * time, to count the people you follow who are *not* on the Following list —
 * your connections. That is one read per fifty followers (190 of them for
 * 9,479) rather than a single request, so it announces `phase: 'scanning'` as
 * it goes and takes a couple of minutes. Nothing is unfollowed either way.
 */
export async function unfollowCountApi(params = {}) {
  const page = await getFollowing({ start: 0, count: UNFOLLOW_SAMPLE_MAX });
  const profiles = page.profiles || [];
  const following = Number.isFinite(page.total) ? page.total : profiles.length;
  const sample = profiles.slice(0, UNFOLLOW_SAMPLE_MAX).map(nameOf);

  if (!isEveryone(params)) return { count: following, sample };

  run.scanned = 0;
  run.scannedTotal = 0;
  let stillFollowing = 0;
  let start = 0;

  for (let page2 = 0; page2 < MAX_SCAN_PAGES; page2 += 1) {
    if (page2) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(scanPauseMs());
    }
    // eslint-disable-next-line no-await-in-loop
    const batch = await getFollowersFollowing({ start, count: FOLLOWERS_PAGE_SIZE });
    const rows = batch.profiles || [];
    if (Number.isFinite(batch.total)) run.scannedTotal = batch.total;
    if (!rows.length) break;

    run.scanned += rows.length;
    for (const row of rows) {
      if (row.following !== true) continue;
      stillFollowing += 1;
      if (sample.length < UNFOLLOW_SAMPLE_MAX) sample.push(nameOf(row));
    }
    // eslint-disable-next-line no-await-in-loop
    await announceScan();

    start += rows.length;
    if (run.scannedTotal > 0 && start >= run.scannedTotal) break;
  }

  return {
    // An upper bound, and deliberately so: the two lists can overlap (somebody
    // you follow who also follows you back, and is not a connection), and the
    // run itself dedupes by urn, so it can do a handful fewer than this says.
    count: following + stillFollowing,
    sample,
    followers: { total: run.scannedTotal, stillFollowing },
  };
}

/**
 * `network.unfollowAll` in API mode.
 *
 * One source by default: LinkedIn's own Following list. Two with
 * `scope: 'everyone'`, and then the limit, the Stop flag, the `seen` set, the
 * failure counter and the challenge latch all carry across both of them — the
 * second being a page-by-page scan of the followers list, because connections
 * are followed automatically on connect and never appear on the Following list
 * at all (see `UNFOLLOW_CAPTURED` in `voyager.js`).
 *
 * `speed: 'fast'` runs three streams over that same queue instead of one, each
 * with its own randomised 0.5–0.9 s gap — about four unfollows a second. It is
 * several times quicker and several times more likely to be the thing LinkedIn
 * rate-limits, which is why the popup makes you tick a box that says so, and
 * why a stand-down answer on *any* stream ends all three.
 *
 * **Failures.** A stand-down answer (401/403/429/451) ends the run on the
 * spot; anything else is allowed one retry's worth of doubt and ends the run
 * on the second in a row. A single failure in the middle of 700 is a person
 * whose state LinkedIn would not change, not a reason to abandon the rest.
 *
 * @param {{limit?: number, dryRun?: boolean, scope?: string, speed?: string}} params
 * @returns {Promise<{unfollowed: number, attempted: number, names: string[],
 *   stopped: 'limit'|'end'|'error'|'cancelled', error?: string}>}
 */
export async function unfollowAllApi(params = {}) {
  const dryRun = !!params.dryRun;
  const everyone = isEveryone(params);
  // A preview sends nothing, so there is nothing for three streams to do.
  const fast = params.speed === 'fast' && !dryRun;

  beginRun(0);
  run.limit = clampLimit(params.limit);
  run.dryRun = dryRun;

  const streams = fast ? UNFOLLOW_FAST_STREAMS : 1;
  const pacing = fast ? UNFOLLOW_FAST_PACING : UNFOLLOW_API_PACING;

  try {
    await drain(followingQueue(), streams, pacing);
    if (everyone && run.stopped === 'end') {
      run.phase = UNFOLLOW_PHASE_SCANNING;
      await drain(followersQueue(), streams, pacing);
    }
  } finally {
    endRun();
  }

  const out = {
    unfollowed: run.unfollowed,
    attempted: run.attempted,
    names: run.names,
    stopped: run.stopped,
  };
  if (run.error) out.error = run.error;
  return out;
}

/* ================================================================== */
/*  Dispatch                                                          */
/* ================================================================== */

const isDom = (params) => (params && params.mode ? params.mode : UNFOLLOW_MODE_DEFAULT) === 'dom';

/** Did the caller ask for the followers list as well? */
const isEveryone = (params) => (params ? params.scope : '') === 'everyone';

/**
 * `network.unfollowCount` — API unless the caller asked for `mode: 'dom'`.
 *
 * `scope` is API-only. The DOM route reads the Following page's own header,
 * and there is no followers page with an Unfollow button on it to click, so a
 * `dom` count answers for the Following list whatever the scope says.
 */
export async function unfollowCount(params = {}) {
  return isDom(params) ? unfollowCountDom() : unfollowCountApi(params);
}

/** `network.unfollowAll` — API unless the caller asked for `mode: 'dom'`. */
export async function unfollowAll(params = {}) {
  return isDom(params) ? unfollowAllDom(params) : unfollowAllApi(params);
}
