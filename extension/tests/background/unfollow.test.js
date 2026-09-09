/**
 * @vitest-environment jsdom
 *
 * Mass unfollow.
 *
 * The in-page half (`unfollowScan`, `unfollowSweep`) is tested against a jsdom
 * fixture of LinkedIn's Following manager — two pages, 30 rows, aria-labelled
 * toggles that flip on click, exactly as the real page behaves. Nothing here
 * touches LinkedIn.
 *
 * The worker half (`unfollowAll`) is tested through the `chrome` mock, because
 * what matters there is not the clicking but the guard rails: one tab id, the
 * tab re-checked between every batch, and a run that stops the moment the tab
 * moves.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  CHALLENGE_TEXT_RE,
  CHALLENGE_URL_RE,
  FOLLOW_BACK_SELECTOR,
  FOLLOWING_URL,
  TOTAL_RE,
  UNFOLLOW_SELECTOR,
  nameFromLabel,
  setSleepFn,
  unfollowAll,
  unfollowCount,
  unfollowScan,
  unfollowSweep,
} from '../../src/background/unfollow.js';
import { UNFOLLOW_LIMIT_MAX } from '../../src/lib/actions.js';
import { FOLLOWING_NAMES, mountFollowingPage } from '../fixtures/following-page.js';
import { setActiveTab } from '../setup.js';

const mock = () => globalThis.chrome.__mock;

/** Every delay set to zero: the pacing is asserted separately, not waited on. */
const sweepOptions = (extra = {}) => ({
  selector: UNFOLLOW_SELECTOR,
  followBackSelector: FOLLOW_BACK_SELECTOR,
  challengeUrlPattern: CHALLENGE_URL_RE.source,
  challengeTextPattern: CHALLENGE_TEXT_RE.source,
  batchMax: 50,
  minDelayMs: 0,
  maxDelayMs: 0,
  pressGapMs: 0,
  confirmMs: 0,
  settleMs: 0,
  ...extra,
});

const names = (result) => result.labels.map(nameFromLabel);

/* ================================================================== */
/*  Names                                                             */
/* ================================================================== */

describe('nameFromLabel', () => {
  it('strips every wording LinkedIn has used for the toggle', () => {
    expect(nameFromLabel('Click to stop following Ada Lovelace')).toBe('Ada Lovelace');
    expect(nameFromLabel('Stop following Grace Hopper')).toBe('Grace Hopper');
    expect(nameFromLabel('Unfollow Alan Turing')).toBe('Alan Turing');
  });

  it('leaves anything it does not recognise alone rather than mangling it', () => {
    expect(nameFromLabel('Karen Spärck Jones')).toBe('Karen Spärck Jones');
    expect(nameFromLabel('')).toBe('Unknown');
  });
});

/* ================================================================== */
/*  Reading the page                                                  */
/* ================================================================== */

describe('unfollowScan', () => {
  it('takes the count from the header, not from the rows on screen', () => {
    // The page loads 20 rows and says it is following 785 people. The honest
    // answer is 785; counting buttons is how the old build under-reported.
    mountFollowingPage({ firstPage: 20, total: 30, headerTotal: 785 });

    const data = unfollowScan({
      selector: UNFOLLOW_SELECTOR,
      totalPattern: TOTAL_RE.source,
      sampleMax: 10,
    });

    expect(data.count).toBe(785);
    expect(data.total).toBe(785);
    expect(data.loaded).toBe(20);
  });

  it('falls back to the loaded rows when the header line is gone', () => {
    mountFollowingPage({ firstPage: 12, total: 30, headerTotal: null });

    const data = unfollowScan({
      selector: UNFOLLOW_SELECTOR,
      totalPattern: TOTAL_RE.source,
      sampleMax: 10,
    });

    expect(data.total).toBeNull();
    expect(data.count).toBe(12);
  });

  it('samples the first ten accessible names', () => {
    mountFollowingPage();

    const data = unfollowScan({
      selector: UNFOLLOW_SELECTOR,
      totalPattern: TOTAL_RE.source,
      sampleMax: 10,
    });

    expect(data.labels).toHaveLength(10);
    expect(data.labels.map(nameFromLabel)).toEqual(FOLLOWING_NAMES.slice(0, 10));
  });
});

/* ================================================================== */
/*  The sweep                                                         */
/* ================================================================== */

describe('unfollowSweep — dry run', () => {
  it('walks both pages and names all 30 without clicking anything', async () => {
    const page = mountFollowingPage({ firstPage: 20, pageSize: 20, total: 30 });

    const result = await unfollowSweep(sweepOptions({ dryRun: true }));

    expect(names(result)).toEqual(FOLLOWING_NAMES);
    expect(result.unfollowed).toBe(0);
    expect(result.attempted).toBe(0);
    expect(page.clicks).toEqual([]);
    expect(page.scrolls).toBeGreaterThan(0); // it did have to page for the last 10
  });

  it('stops at the limit and does not scroll for rows it will not report', async () => {
    const page = mountFollowingPage({ firstPage: 20, pageSize: 20, total: 30 });

    const result = await unfollowSweep(sweepOptions({ dryRun: true, limit: 5 }));

    expect(names(result)).toEqual(FOLLOWING_NAMES.slice(0, 5));
    expect(page.clicks).toEqual([]);
    expect(page.scrolls).toBe(0);
  });

  it('refuses to preview a challenge page', async () => {
    mountFollowingPage();
    document.body.textContent = 'We noticed some unusual activity on your account.';

    const result = await unfollowSweep(sweepOptions({ dryRun: true }));

    expect(result.challenge).toBe(true);
    expect(result.labels).toEqual([]);
    expect(result.error).toMatch(/verification or restriction/i);
  });
});

describe('unfollowSweep — unfollowing', () => {
  it('stops after `limit` successful unfollows', async () => {
    const page = mountFollowingPage();

    const result = await unfollowSweep(sweepOptions({ limit: 3 }));

    expect(page.clicks).toEqual(FOLLOWING_NAMES.slice(0, 3));
    expect(result.unfollowed).toBe(3);
    expect(result.attempted).toBe(3);
    expect(names(result)).toEqual(FOLLOWING_NAMES.slice(0, 3));
    expect(result.hasMore).toBe(true);
  });

  it('unfollows exactly one when asked for one — the run you try first', async () => {
    const page = mountFollowingPage();

    const result = await unfollowSweep(sweepOptions({ limit: 1 }));

    expect(page.clicks).toEqual(['Ada Lovelace']);
    expect(result.unfollowed).toBe(1);
    expect(page.rows()[0].querySelector('button').getAttribute('aria-label')).toBe(
      'Click to follow Ada Lovelace',
    );
  });

  it('hands control back after a batch so the worker can re-check the tab', async () => {
    const page = mountFollowingPage();

    const result = await unfollowSweep(sweepOptions({ batchMax: 10 }));

    expect(result.unfollowed).toBe(10);
    expect(result.hasMore).toBe(true);
    expect(page.clicks).toHaveLength(10);
  });

  it('pages by scrolling and gets through all 30 across batches', async () => {
    const page = mountFollowingPage({ firstPage: 20, pageSize: 20, total: 30 });

    let unfollowed = 0;
    for (let pass = 0; pass < 5 && unfollowed < 30; pass += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await unfollowSweep(sweepOptions({ batchMax: 10 }));
      unfollowed += result.unfollowed;
      if (!result.hasMore) break;
    }

    expect(unfollowed).toBe(30);
    expect(page.clicks).toEqual(FOLLOWING_NAMES);
  });

  it('counts a button that never flips as attempted but not unfollowed', async () => {
    const page = mountFollowingPage({ total: 2, firstPage: 2 });
    // A row that swallows the click — LinkedIn erroring, or markup drift.
    const stubborn = page.rows()[0].querySelector('button');
    stubborn.replaceWith(stubborn.cloneNode(true));

    const result = await unfollowSweep(sweepOptions({ batchMax: 2 }));

    expect(result.attempted).toBe(2);
    expect(result.unfollowed).toBe(1);
    expect(names(result)).toEqual(['Grace Hopper']);
  });

  it('stops the moment a challenge appears, keeping what it already did', async () => {
    const page = mountFollowingPage({ challengeAfter: 2 });

    const result = await unfollowSweep(sweepOptions({ batchMax: 50 }));

    expect(page.clicks).toEqual(FOLLOWING_NAMES.slice(0, 2));
    expect(result.unfollowed).toBe(2);
    expect(result.challenge).toBe(true);
    expect(result.error).toMatch(/verification or restriction/i);
    expect(names(result)).toEqual(FOLLOWING_NAMES.slice(0, 2));
  });
});

/* ================================================================== */
/*  The worker loop                                                   */
/* ================================================================== */

/** Seed one active tab already sitting on the following list. */
const onFollowingPage = () => setActiveTab(FOLLOWING_URL);

/** A sweep result the worker will accept, with the page's own fields. */
const sweepResult = (over = {}) => [
  {
    result: {
      unfollowed: 1,
      attempted: 1,
      labels: ['Click to stop following Ada Lovelace'],
      remaining: 19,
      hasMore: true,
      challenge: false,
      error: null,
      ...over,
    },
  },
];

/**
 * Let the page's first batch land, then have the tab do something behind the
 * run's back. This is the only way to reach the between-batch guard: the run
 * puts the tab on the following list itself, so it is always there at pass one.
 */
function moveTabAfterFirstBatch(change) {
  const inner = chrome.scripting.executeScript;
  chrome.scripting.executeScript = vi.fn(async (injection) => {
    const out = await inner(injection);
    await change();
    return out;
  });
}

// The worker's own pacing is 2 s between batches and 3–4 s after a navigation.
// Those are real waits in a browser and dead time in a test.
beforeEach(() => setSleepFn(() => Promise.resolve()));

describe('unfollowCount', () => {
  it('reports the header total and the sample of names', async () => {
    onFollowingPage();
    mock().executeScriptResults = [
      [{ result: { count: 785, loaded: 20, total: 785, labels: ['Click to stop following Ada Lovelace'] } }],
    ];

    expect(await unfollowCount()).toEqual({ count: 785, sample: ['Ada Lovelace'] });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('still answers an older page that resolved to a bare number', async () => {
    onFollowingPage();
    mock().executeScriptResults = [[{ result: 7 }]];

    expect(await unfollowCount()).toEqual({ count: 7, sample: [] });
  });
});

describe('unfollowAll', () => {
  it('passes the limit down and stops at it', async () => {
    onFollowingPage();
    mock().executeScriptResults = [
      [
        {
          result: {
            unfollowed: 2,
            attempted: 2,
            labels: ['Click to stop following Ada Lovelace', 'Click to stop following Grace Hopper'],
            remaining: 18,
            hasMore: true,
            challenge: false,
          },
        },
      ],
    ];

    const result = await unfollowAll({ limit: 2 });

    expect(result).toEqual({
      unfollowed: 2,
      attempted: 2,
      names: ['Ada Lovelace', 'Grace Hopper'],
      stopped: 'limit',
    });
    expect(mock().executeScriptCalls[0].args[0].limit).toBe(2);
    expect(mock().executeScriptCalls[0].args[0].dryRun).toBe(false);
  });

  it('treats an empty limit as the contract ceiling, not as infinity', async () => {
    onFollowingPage();
    mock().executeScriptResults = [
      [{ result: { unfollowed: 0, attempted: 0, labels: [], remaining: 0, hasMore: false } }],
    ];

    const result = await unfollowAll({});

    expect(mock().executeScriptCalls[0].args[0].limit).toBe(UNFOLLOW_LIMIT_MAX);
    expect(result.stopped).toBe('end');
  });

  it('reports a dry run as a preview: names, and nothing done', async () => {
    onFollowingPage();
    mock().executeScriptResults = [
      [
        {
          result: {
            unfollowed: 0,
            attempted: 0,
            labels: ['Click to stop following Ada Lovelace'],
            remaining: 20,
            hasMore: false,
            challenge: false,
          },
        },
      ],
    ];

    const result = await unfollowAll({ limit: 5, dryRun: true });

    expect(result).toEqual({
      unfollowed: 0,
      attempted: 0,
      names: ['Ada Lovelace'],
      stopped: 'end',
    });
    expect(mock().executeScriptCalls[0].args[0].dryRun).toBe(true);
    // A preview must never announce progress as if it had unfollowed anyone.
    expect(mock().messages.filter((m) => m.type === 'UNFOLLOW_PROGRESS')).toEqual([]);
  });

  it('stops as soon as the tab navigates off the following list', async () => {
    const tab = onFollowingPage();
    mock().executeScriptResults = [sweepResult(), sweepResult()];
    moveTabAfterFirstBatch(() =>
      chrome.tabs.update(tab.id, { url: 'https://www.linkedin.com/feed/' }),
    );

    const result = await unfollowAll({ limit: 50 });

    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(/moved away from your Following list/);
    expect(result.unfollowed).toBe(1); // the first batch counted; nothing after
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('stops as soon as the tab lands on a checkpoint page', async () => {
    const tab = onFollowingPage();
    mock().executeScriptResults = [sweepResult(), sweepResult()];
    moveTabAfterFirstBatch(() =>
      chrome.tabs.update(tab.id, { url: 'https://www.linkedin.com/checkpoint/challenge/' }),
    );

    const result = await unfollowAll({ limit: 50 });

    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(/checkpoint/i);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('stops when the tab is closed mid-run', async () => {
    const tab = onFollowingPage();
    mock().executeScriptResults = [sweepResult(), sweepResult()];
    moveTabAfterFirstBatch(() => chrome.tabs.remove(tab.id));

    const result = await unfollowAll({ limit: 50 });

    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(/closed/i);
  });

  it('carries a challenge the page saw back to the caller', async () => {
    onFollowingPage();
    mock().executeScriptResults = [
      [
        {
          result: {
            unfollowed: 2,
            attempted: 3,
            labels: ['Click to stop following Ada Lovelace', 'Click to stop following Grace Hopper'],
            remaining: 18,
            hasMore: false,
            challenge: true,
            error: 'LinkedIn showed a verification or restriction page',
          },
        },
      ],
    ];

    const result = await unfollowAll({ limit: 50 });

    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(/verification or restriction/);
    expect(result.unfollowed).toBe(2);
    expect(result.attempted).toBe(3);
  });

  it('only ever scripts the tab the popup pointed it at', async () => {
    // A second, inactive LinkedIn tab is exactly the thing that must not move.
    await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: false });
    const target = onFollowingPage();
    mock().executeScriptResults = [
      [{ result: { unfollowed: 1, attempted: 1, labels: ['Unfollow Ada Lovelace'], remaining: 0, hasMore: false } }],
    ];

    await unfollowAll({ limit: 1 });

    expect(mock().executeScriptCalls).toHaveLength(1);
    for (const call of mock().executeScriptCalls) {
      expect(call.target.tabId).toBe(target.id);
    }
  });
});
