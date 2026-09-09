/**
 * @vitest-environment jsdom
 *
 * Mass unfollow, both modes.
 *
 * **DOM mode.** The in-page half (`unfollowScan`, `unfollowSweep`) is tested
 * against a jsdom fixture of LinkedIn's Following manager — two pages, 30
 * rows, aria-labelled toggles that flip on click, exactly as the real page
 * behaves. The worker half is tested through the `chrome` mock, because what
 * matters there is not the clicking but the guard rails: one tab id, the tab
 * re-checked between every batch, and a run that stops the moment it moves.
 *
 * **API mode.** Tested through a `fetch` stub holding a Following list that
 * actually shrinks as the run works through it, so the paging arithmetic has
 * to be right rather than merely plausible.
 *
 * Nothing here touches LinkedIn. Every name below is invented.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  CHALLENGE_TEXT_RE,
  CHALLENGE_URL_RE,
  FOLLOW_BACK_SELECTOR,
  FOLLOWING_URL,
  TOTAL_RE,
  UNFOLLOW_API_PACING,
  UNFOLLOW_FAST_PACING,
  UNFOLLOW_SCAN_PACING,
  UNFOLLOW_SELECTOR,
  nameFromLabel,
  setSleepFn,
  unfollowAll,
  unfollowCount,
  unfollowScan,
  unfollowStatus,
  unfollowStop,
  unfollowSweep,
} from '../../src/background/unfollow.js';
import { noteBackoff } from '../../src/background/quota.js';
import { EVENTS, UNFOLLOW_LIMIT_MAX } from '../../src/lib/actions.js';
import { FOLLOWING_NAMES, mountFollowingPage } from '../fixtures/following-page.js';
import followingPage1 from '../fixtures/voyager/following.json';
import followingPage2 from '../fixtures/voyager/followingPage2.json';
import followersPage1 from '../fixtures/voyager/followersFollowing.json';
import followersPage2 from '../fixtures/voyager/followersFollowingPage2.json';
import { seedSession, status, stubFetch } from '../helpers/net.js';
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

    expect(await unfollowCount({ mode: 'dom' })).toEqual({ count: 785, sample: ['Ada Lovelace'] });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('still answers an older page that resolved to a bare number', async () => {
    onFollowingPage();
    mock().executeScriptResults = [[{ result: 7 }]];

    expect(await unfollowCount({ mode: 'dom' })).toEqual({ count: 7, sample: [] });
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

    const result = await unfollowAll({ limit: 2, mode: 'dom' });

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

    const result = await unfollowAll({ mode: 'dom' });

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

    const result = await unfollowAll({ limit: 5, dryRun: true, mode: 'dom' });

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

    const result = await unfollowAll({ limit: 50, mode: 'dom' });

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

    const result = await unfollowAll({ limit: 50, mode: 'dom' });

    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(/checkpoint/i);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('stops when the tab is closed mid-run', async () => {
    const tab = onFollowingPage();
    mock().executeScriptResults = [sweepResult(), sweepResult()];
    moveTabAfterFirstBatch(() => chrome.tabs.remove(tab.id));

    const result = await unfollowAll({ limit: 50, mode: 'dom' });

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

    const result = await unfollowAll({ limit: 50, mode: 'dom' });

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

    await unfollowAll({ limit: 1, mode: 'dom' });

    expect(mock().executeScriptCalls).toHaveLength(1);
    for (const call of mock().executeScriptCalls) {
      expect(call.target.tabId).toBe(target.id);
    }
  });
});

/* ================================================================== */
/*  API mode                                                          */
/* ================================================================== */
/*                                                                    */
/*  Nothing here touches LinkedIn either: `stubFetch` answers every    */
/*  request from a fake Following list built out of the two captured-  */
/*  shape fixtures, and that list *shrinks* as the run unfollows from  */
/*  it, which is the only way to prove the paging arithmetic does not  */
/*  step over anybody.                                                */
/*                                                                    */
/* ================================================================== */

const PATCH_BODY = '{"patch":{"$set":{"following":false}}}';

/** Every fictional person in the two fixtures, in list order. */
const ENTITIES = [...followingPage1.included, ...followingPage2.included];
const FOLLOWING = ENTITIES.map((e) => e.title.text);
const URNS = ENTITIES.map((e) => e.entityUrn.match(/urn:li:fsd_profile:[^,)]+/)[0]);

/** The state urn LinkedIn is addressed by, and the path it becomes. */
const statePath = (profileUrn) =>
  `https://www.linkedin.com/voyager/api/feed/dash/followingStates/${encodeURIComponent(
    `urn:li:fsd_followingState:${profileUrn}`,
  )}`;

/**
 * A living Following list behind the stub.
 *
 * Reads page it, and a successful unfollow removes that person from it — so a
 * second read at the same offset returns different people, exactly as it does
 * against LinkedIn. `onPost` lets a test make the nth write fail.
 */
function followingWorld(net, onPost = null) {
  const world = { remaining: [...ENTITIES], posts: [], reads: [] };

  /**
   * LinkedIn is under no obligation to send back as many as we asked for — the
   * live client asks for ten and gets ten — so the fake serves at most ten
   * whatever `count` says. Code that assumed it got its whole page would page
   * straight over somebody, and this is what catches that.
   */
  const PAGE_CAP = 10;

  const clusters = (start, count) => {
    const slice = world.remaining.slice(start, start + Math.min(count, PAGE_CAP));
    return {
      data: {
        data: {
          searchDashClustersByAll: {
            metadata: { totalResultCount: world.remaining.length },
            paging: { start, count, total: world.remaining.length },
            elements: [
              {
                items: slice.map((entity, i) => ({
                  item: { '*entityResult': entity.entityUrn },
                  position: i + 1,
                })),
              },
            ],
          },
        },
        errors: [],
      },
      included: slice,
    };
  };

  net.route(
    (url) => url.includes('voyagerSearchDashClusters'),
    (url) => {
      const decoded = decodeURIComponent(url);
      const start = Number((decoded.match(/start:(\d+)/) || [])[1] || 0);
      const count = Number((decoded.match(/count:(\d+)/) || [])[1] || 10);
      world.reads.push({ start, count });
      return clusters(start, count);
    },
  );

  net.route(
    (url) => url.includes('/feed/dash/followingStates/'),
    (url) => {
      const urn = decodeURIComponent(url.split('/followingStates/')[1]);
      const profileUrn = urn.replace('urn:li:fsd_followingState:', '');
      world.posts.push(profileUrn);

      const failure = onPost ? onPost(world.posts.length, profileUrn, world) : null;
      if (failure) return status(failure, {});

      world.remaining = world.remaining.filter((e) => !e.entityUrn.includes(profileUrn));
      return undefined; // LinkedIn answers 200 with an empty body
    },
  );

  return world;
}

const nameFor = (i) => FOLLOWING[i];

describe('API mode — reading the list', () => {
  let net;

  beforeEach(() => {
    seedSession();
    net = stubFetch();
  });

  it('sends exactly the query the Following manager sends', async () => {
    net.route('voyagerSearchDashClusters', followingPage1);

    await unfollowCount();

    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].method).toBe('GET');
    expect(decodeURIComponent(net.calls[0].url)).toBe(
      'https://www.linkedin.com/voyager/api/graphql?variables=' +
        '(start:0,count:10,origin:CurationHub,query:(flagshipSearchIntent:MYNETWORK_CURATION_HUB,' +
        'includeFiltersInResponse:true,queryParameters:List((key:resultType,value:List(PEOPLE_FOLLOW)))))' +
        '&queryId=voyagerSearchDashClusters.e438ab99259203e9c1cd3f358e217282',
    );
  });

  it('answers the total from totalResultCount, not from the page', async () => {
    net.route('voyagerSearchDashClusters', followingPage1);

    const data = await unfollowCount();

    // Ten came back; twelve is the honest answer, and it needed no tab.
    expect(data.count).toBe(12);
    expect(data.sample).toEqual(FOLLOWING.slice(0, 10));
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});

describe('API mode — the unfollow write', () => {
  let net;

  beforeEach(() => {
    seedSession();
    net = stubFetch();
  });

  it('POSTs the captured path, headers and body, once per person', async () => {
    followingWorld(net);

    const result = await unfollowAll({ limit: 1 });

    const post = net.calls.find((c) => c.method === 'POST');
    expect(post.url).toBe(statePath(URNS[0]));
    // The urn is percent-encoded, as every urn in a path in this engine is.
    expect(post.url).toContain('urn%3Ali%3Afsd_followingState%3Aurn%3Ali%3Afsd_profile%3A');
    expect(post.url).not.toContain('?');
    expect(post.body).toBe(PATCH_BODY);
    expect(post.headers['csrf-token']).toBe('ajax:1234567890');
    expect(post.headers['x-restli-protocol-version']).toBe('2.0.0');
    expect(post.headers.accept).toBe('application/vnd.linkedin.normalized+json+2.1');
    expect(post.headers['content-type']).toBe('application/json; charset=UTF-8');
    expect(post.credentials).toBe('include');

    expect(result).toEqual({
      unfollowed: 1,
      attempted: 1,
      names: [nameFor(0)],
      stopped: 'limit',
    });
  });

  it('stops at the limit and touches nobody past it', async () => {
    const world = followingWorld(net);

    const result = await unfollowAll({ limit: 3 });

    expect(world.posts).toEqual(URNS.slice(0, 3));
    expect(result.unfollowed).toBe(3);
    expect(result.attempted).toBe(3);
    expect(result.names).toEqual(FOLLOWING.slice(0, 3));
    expect(result.stopped).toBe('limit');
  });

  it('works through the whole list, paging as it shrinks', async () => {
    const world = followingWorld(net);

    const result = await unfollowAll({});

    expect(result.unfollowed).toBe(12);
    expect(result.attempted).toBe(12);
    expect(result.stopped).toBe('end');
    // Everybody exactly once, nobody skipped, in list order.
    expect(world.posts).toEqual(URNS);
    expect(result.names).toEqual(FOLLOWING);
    expect(world.remaining).toEqual([]);
  });

  it('paces itself with a randomised 0.8-1.6 second gap', async () => {
    followingWorld(net);
    const waits = [];
    setSleepFn((ms) => {
      waits.push(ms);
      return Promise.resolve();
    });

    await unfollowAll({ limit: 4 });

    // Three gaps for four people: there is nothing to wait for after the last.
    expect(waits).toHaveLength(3);
    for (const ms of waits) {
      expect(ms).toBeGreaterThanOrEqual(UNFOLLOW_API_PACING.minDelayMs);
      expect(ms).toBeLessThanOrEqual(UNFOLLOW_API_PACING.maxDelayMs);
    }
    // Randomised, not a metronome — a flat interval is its own signature.
    expect(new Set(waits).size).toBeGreaterThan(1);
  });
});

describe('API mode — dry run', () => {
  let net;

  beforeEach(() => {
    seedSession();
    net = stubFetch();
  });

  it('names everybody across both pages and writes nothing', async () => {
    const world = followingWorld(net);

    const result = await unfollowAll({ dryRun: true });

    expect(result).toEqual({
      unfollowed: 0,
      attempted: 0,
      names: FOLLOWING,
      stopped: 'end',
    });
    expect(world.posts).toEqual([]);
    expect(net.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(world.remaining).toHaveLength(12);
    // Two pages, because the list did not shrink under it.
    expect(world.reads.map((r) => r.start)).toEqual([0, 10]);
  });

  it('honours the limit and does not read a page it will not report', async () => {
    const world = followingWorld(net);

    const result = await unfollowAll({ limit: 4, dryRun: true });

    expect(result.names).toEqual(FOLLOWING.slice(0, 4));
    expect(result.stopped).toBe('limit');
    expect(world.reads).toHaveLength(1);
    expect(world.posts).toEqual([]);
  });

  it('announces no progress for a preview', async () => {
    followingWorld(net);

    await unfollowAll({ dryRun: true });

    expect(mock().messages.filter((m) => m.event === 'unfollow_progress')).toEqual([]);
  });
});

describe('API mode — standing down', () => {
  let net;

  beforeEach(() => {
    seedSession();
    net = stubFetch();
  });

  it('stops dead on a 451 and keeps what it already did', async () => {
    const world = followingWorld(net, (n) => (n === 2 ? 451 : null));

    const result = await unfollowAll({});

    expect(world.posts).toHaveLength(2);
    expect(result.unfollowed).toBe(1);
    expect(result.attempted).toBe(2);
    expect(result.names).toEqual([nameFor(0)]);
    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(/security challenge/i);
  });

  it.each([
    [429, /rate limited/i],
    [401, /log in again/i],
    [403, /denied access/i],
  ])('stops dead on a %i', async (code, matcher) => {
    const world = followingWorld(net, (n) => (n === 1 ? code : null));

    const result = await unfollowAll({});

    expect(world.posts).toHaveLength(1);
    expect(result.unfollowed).toBe(0);
    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(matcher);
  });

  it('shrugs off one failure and carries on', async () => {
    const world = followingWorld(net, (n) => (n === 2 ? 500 : null));

    const result = await unfollowAll({});

    // Everybody was tried; the one LinkedIn refused is the shortfall.
    expect(world.posts).toHaveLength(12);
    expect(result.attempted).toBe(12);
    expect(result.unfollowed).toBe(11);
    expect(result.names).not.toContain(nameFor(1));
    expect(result.stopped).toBe('end');
  });

  it('stops after two failures in a row', async () => {
    const world = followingWorld(net, (n) => (n === 2 || n === 3 ? 500 : null));

    const result = await unfollowAll({});

    expect(world.posts).toHaveLength(3);
    expect(result.unfollowed).toBe(1);
    expect(result.attempted).toBe(3);
    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(/two unfollows in a row/i);
  });

  it('refuses to start at all while the challenge latch is set', async () => {
    const world = followingWorld(net);
    await noteBackoff(451);

    const result = await unfollowAll({});

    expect(result.unfollowed).toBe(0);
    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(/challenge/i);
    expect(world.posts).toEqual([]);
    expect(net.calls).toEqual([]);
  });
});

describe('API mode — stop and status', () => {
  let net;

  beforeEach(() => {
    seedSession();
    net = stubFetch();
  });

  it('reports nothing running when nothing is', () => {
    expect(unfollowStatus()).toEqual({ running: false, done: 0, total: 0, lastName: '' });
    expect(unfollowStop()).toEqual({ stopping: false });
  });

  it('ends the run between people when Stop is pressed', async () => {
    followingWorld(net, (n) => {
      if (n === 2) expect(unfollowStop()).toEqual({ stopping: true });
      return null;
    });

    const result = await unfollowAll({});

    expect(result.unfollowed).toBe(2);
    expect(result.attempted).toBe(2);
    expect(result.names).toEqual(FOLLOWING.slice(0, 2));
    // Nothing went wrong: `cancelled` is not `error`, and there is no message.
    expect(result.stopped).toBe('cancelled');
    expect(result.error).toBeUndefined();
  });

  it('leaves no flag set for the next run to trip over', async () => {
    let stopOnce = true;
    followingWorld(net, () => {
      if (stopOnce) {
        stopOnce = false;
        unfollowStop();
      }
      return null;
    });

    const first = await unfollowAll({});
    expect(first.stopped).toBe('cancelled');
    expect(first.unfollowed).toBe(1);
    expect(unfollowStatus().running).toBe(false);

    const second = await unfollowAll({ limit: 2 });
    expect(second.unfollowed).toBe(2);
    expect(second.stopped).toBe('limit');
  });

  it('answers where the run has got to while it is running', async () => {
    const seen = [];
    followingWorld(net, () => {
      seen.push(unfollowStatus());
      return null;
    });

    await unfollowAll({ limit: 3 });

    // The third write is issued after two have landed.
    expect(seen[2]).toEqual({
      running: true,
      done: 2,
      total: 12,
      lastName: nameFor(1),
    });
    // And the final state survives the run, so a late poll still reads it.
    expect(unfollowStatus()).toEqual({
      running: false,
      done: 3,
      total: 12,
      lastName: nameFor(2),
    });
  });
});

describe('API mode — progress events', () => {
  let net;

  beforeEach(() => {
    seedSession();
    net = stubFetch();
  });

  it('emits unfollow_progress every ten, and not once per person', async () => {
    followingWorld(net);

    await unfollowAll({});

    const progress = mock().messages.filter((m) => m.event === EVENTS.UNFOLLOW_PROGRESS);
    expect(progress.map((m) => m.payload)).toEqual([{ done: 10, total: 12 }]);
  });

  it('does not announce the same ten twice when the next one fails', async () => {
    // The eleventh write fails, so the count stays at ten. Announcing again
    // would have a progress line stall on a number it had already reported.
    followingWorld(net, (n) => (n === 11 ? 500 : null));

    await unfollowAll({});

    const progress = mock().messages.filter((m) => m.event === EVENTS.UNFOLLOW_PROGRESS);
    expect(progress.map((m) => m.payload)).toEqual([{ done: 10, total: 12 }]);
  });
});

/* ================================================================== */
/*  scope: 'everyone' — the followers list                             */
/* ================================================================== */
/*                                                                    */
/*  LinkedIn's Following list does not include connections. The only   */
/*  place their follow state is visible is the followers list, one     */
/*  `FollowingState` per row — so a run that means "everyone" has two  */
/*  sources, and everything below is about the two behaving as one:    */
/*  one limit, one seen set, one Stop, one failure counter.            */
/*                                                                    */
/*  Every follower below is invented, and comes out of the two         */
/*  fixtures rather than being typed twice.                            */
/*                                                                    */
/* ================================================================== */

/** One follower as the fixtures carry them: view model, state and profile. */
function followerRows(page) {
  const rows = [];
  for (const entity of page.included) {
    if (!String(entity.$type).endsWith('search.EntityResultViewModel')) continue;
    const urn = entity.entityUrn.match(/urn:li:fsd_profile:[^,)]+/)[0];
    const state = page.included.find((e) => e.entityUrn === `urn:li:fsd_followingState:${urn}`);
    const profile = page.included.find((e) => e.entityUrn === urn);
    rows.push({
      urn,
      name: entity.title.text,
      following: state.following,
      included: [entity, state, profile],
    });
  }
  return rows;
}

const FOLLOWERS = [...followerRows(followersPage1), ...followerRows(followersPage2)];
const STILL_FOLLOWED = FOLLOWERS.filter((row) => row.following).map((row) => row.name);

/**
 * The same follower, cloned onto somebody the Following list already covered.
 *
 * This is the overlap the `seen` set exists for: a person you follow who also
 * follows you back turns up in both sources, and must be unfollowed once.
 */
function alias(row, urn, name) {
  const included = JSON.parse(JSON.stringify(row.included).split(row.urn).join(urn));
  included[0].title.text = name;
  return { urn, name, following: true, included };
}

/**
 * A followers list behind the stub.
 *
 * It does *not* shrink as the run works through it — unfollowing somebody does
 * not stop them following you — so the cursor has to page forward, and this is
 * what proves it does. Six a page, because LinkedIn answers with what it likes
 * rather than with the fifty it was asked for.
 */
function followersWorld(net, rows = FOLLOWERS, onRead = null) {
  const world = { rows: rows.map((row) => ({ ...row })), reads: [] };
  const PAGE_CAP = 6;

  const clusters = (start, count) => {
    const slice = world.rows.slice(start, start + Math.min(count, PAGE_CAP));
    return {
      data: {
        data: {
          searchDashClustersByAll: {
            metadata: { totalResultCount: world.rows.length },
            paging: { start, count, total: world.rows.length },
            elements: [
              {
                items: slice.map((row, i) => ({
                  item: { '*entityResult': row.included[0].entityUrn },
                  position: i + 1,
                })),
              },
            ],
          },
        },
        errors: [],
      },
      included: slice.flatMap((row) => [
        row.included[0],
        { ...row.included[1], following: row.following },
        row.included[2],
      ]),
    };
  };

  net.route(
    (url) => url.includes('voyagerSearchDashClusters') && url.includes('List(FOLLOWERS)'),
    (url) => {
      const decoded = decodeURIComponent(url);
      const start = Number((decoded.match(/start:(\d+)/) || [])[1] || 0);
      const count = Number((decoded.match(/count:(\d+)/) || [])[1] || 50);
      world.reads.push({ start, count });
      const failure = onRead ? onRead(world.reads.length, world) : null;
      if (failure) return status(failure, {});
      return clusters(start, count);
    },
  );

  return world;
}

/** Both sources at once, followers registered last so its route wins. */
function everyoneWorld(net, { onPost = null, rows = FOLLOWERS, onRead = null } = {}) {
  const following = followingWorld(net, onPost);
  const followers = followersWorld(net, rows, onRead);
  // LinkedIn does stop reporting somebody as followed once you unfollow them.
  const post = (urn) => {
    const row = followers.rows.find((r) => r.urn === urn);
    if (row) row.following = false;
  };
  return { following, followers, post };
}

describe('API mode — scope: everyone', () => {
  let net;

  beforeEach(() => {
    seedSession();
    net = stubFetch();
  });

  it('works the Following list first and the followers list second', async () => {
    const world = everyoneWorld(net);

    const result = await unfollowAll({ scope: 'everyone' });

    // Twelve off the Following list, then the six followers whose own state
    // still says we follow them — the connections that list never mentions.
    expect(result.unfollowed).toBe(18);
    expect(result.attempted).toBe(18);
    expect(result.stopped).toBe('end');
    expect(result.names.slice(0, 12)).toEqual(FOLLOWING);
    expect(result.names.slice(12)).toEqual(STILL_FOLLOWED);
    expect(world.following.posts).toHaveLength(18);
  });

  it('leaves the followers it is not following alone', async () => {
    const world = everyoneWorld(net);

    await unfollowAll({ scope: 'everyone' });

    const untouched = FOLLOWERS.filter((row) => !row.following);
    expect(untouched).toHaveLength(4);
    for (const row of untouched) expect(world.following.posts).not.toContain(row.urn);
  });

  it('reads the followers list page by page, always forwards', async () => {
    // The list does not shrink underneath the cursor, so a cursor that stayed
    // put would read the same six people for ever.
    const world = everyoneWorld(net);

    await unfollowAll({ scope: 'everyone' });

    expect(world.followers.reads.map((r) => r.start)).toEqual([0, 6]);
    expect(world.followers.reads.every((r) => r.count === 50)).toBe(true);
  });

  it('never touches the same person twice when they are on both lists', async () => {
    const overlap = alias(FOLLOWERS[0], URNS[0], FOLLOWING[0]);
    const world = everyoneWorld(net, { rows: [overlap, ...FOLLOWERS] });

    const result = await unfollowAll({ scope: 'everyone' });

    expect(new Set(world.following.posts).size).toBe(world.following.posts.length);
    expect(world.following.posts.filter((urn) => urn === URNS[0])).toHaveLength(1);
    expect(result.unfollowed).toBe(18);
  });

  it('spends one limit across both sources, not one each', async () => {
    const world = everyoneWorld(net);

    const result = await unfollowAll({ scope: 'everyone', limit: 15 });

    expect(result.unfollowed).toBe(15);
    expect(result.stopped).toBe('limit');
    // Twelve from the Following list and three from the followers scan.
    expect(world.following.posts).toHaveLength(15);
    expect(result.names.slice(12)).toEqual(STILL_FOLLOWED.slice(0, 3));
  });

  it('does not scan the followers list at all when the first source stops', async () => {
    const world = everyoneWorld(net);

    const result = await unfollowAll({ scope: 'everyone', limit: 5 });

    expect(result.stopped).toBe('limit');
    expect(world.followers.reads).toEqual([]);
  });

  it('stops mid-scan when Stop is pressed, and keeps what it did', async () => {
    const world = everyoneWorld(net, {
      onPost: (n) => {
        if (n === 14) unfollowStop();
        return null;
      },
    });

    const result = await unfollowAll({ scope: 'everyone' });

    expect(result.unfollowed).toBe(14);
    expect(result.stopped).toBe('cancelled');
    expect(result.error).toBeUndefined();
    expect(world.following.posts).toHaveLength(14);
  });

  it('stops dead on a 429 while the scan is reading', async () => {
    const world = everyoneWorld(net, { onRead: (n) => (n === 2 ? 429 : null) });

    const result = await unfollowAll({ scope: 'everyone' });

    // Twelve off the Following list plus the four still-followed people on the
    // first followers page; the second page is where LinkedIn said stop.
    expect(result.unfollowed).toBe(16);
    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(/rate limited/i);
    expect(world.followers.reads).toHaveLength(2);
  });

  it('announces the scan as a scan, not as unfollows', async () => {
    everyoneWorld(net);

    await unfollowAll({ scope: 'everyone' });

    const scanning = mock()
      .messages.filter((m) => m.event === EVENTS.UNFOLLOW_PROGRESS)
      .map((m) => m.payload)
      .filter((p) => p.phase === 'scanning');
    expect(scanning).toEqual([
      { done: 6, total: 10, phase: 'scanning' },
      { done: 10, total: 10, phase: 'scanning' },
    ]);
  });

  it('says where the scan has got to while it is scanning', async () => {
    const seen = [];
    everyoneWorld(net, {
      onPost: (n) => {
        if (n > 12) seen.push(unfollowStatus());
        return null;
      },
    });

    await unfollowAll({ scope: 'everyone' });

    expect(seen[0]).toMatchObject({ running: true, phase: 'scanning', scanned: 6, scannedTotal: 10 });
    // `total` is what is left to do, not what was there to begin with: the
    // Following list reads zero by now, and the first followers page turned up
    // four more people.
    expect(seen[0].total).toBe(4);
    // And nothing about a scan leaks into a run that never had one.
    expect(unfollowStatus().phase).toBeUndefined();
  });

  it('paces the followers reads at 0.4-0.8 s, half the gap between writes', async () => {
    everyoneWorld(net);
    const waits = [];
    setSleepFn((ms) => {
      waits.push(ms);
      return Promise.resolve();
    });

    await unfollowAll({ scope: 'everyone' });

    const reads = waits.filter((ms) => ms < UNFOLLOW_API_PACING.minDelayMs);
    // One gap for the second followers page; the first is read straight away.
    expect(reads).toHaveLength(1);
    for (const ms of reads) {
      expect(ms).toBeGreaterThanOrEqual(UNFOLLOW_SCAN_PACING.minDelayMs);
      expect(ms).toBeLessThanOrEqual(UNFOLLOW_SCAN_PACING.maxDelayMs);
    }
  });

  it('previews both sources without writing anything', async () => {
    const world = everyoneWorld(net);

    const result = await unfollowAll({ scope: 'everyone', dryRun: true });

    expect(result.unfollowed).toBe(0);
    expect(result.attempted).toBe(0);
    expect(result.names).toEqual([...FOLLOWING, ...STILL_FOLLOWED]);
    expect(world.following.posts).toEqual([]);
    expect(net.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('is the Following list only when the scope is left off', async () => {
    const world = everyoneWorld(net);

    const result = await unfollowAll({});

    expect(result.unfollowed).toBe(12);
    expect(world.followers.reads).toEqual([]);
  });
});

/* ================================================================== */
/*  speed: 'fast' — three streams                                     */
/* ================================================================== */

/** Let every pending microtask run, without waiting on a real timer. */
async function tick(times = 30) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

/**
 * A sleep that parks every stream until the test lets it go.
 *
 * This is what makes three streams observable: with nobody released, the only
 * requests that can have been sent are the ones three streams sent at once.
 */
function parkingSleep() {
  const parked = [];
  const waits = [];
  setSleepFn((ms) => {
    waits.push(ms);
    return new Promise((resolve) => parked.push(resolve));
  });
  return {
    parked,
    waits,
    /** Drive a run to completion, releasing whoever is waiting. */
    async settle(promise) {
      let done = false;
      const settled = promise.then((value) => {
        done = true;
        return value;
      });
      for (let i = 0; i < 500 && !done; i += 1) {
        parked.splice(0).forEach((resolve) => resolve());
        // eslint-disable-next-line no-await-in-loop
        await tick(10);
      }
      return settled;
    },
  };
}

describe('API mode — speed: fast', () => {
  let net;

  beforeEach(() => {
    seedSession();
    net = stubFetch();
  });

  it('has three requests in flight at once, where careful has one', async () => {
    const world = followingWorld(net);
    const clock = parkingSleep();

    const running = unfollowAll({ speed: 'fast' });
    await tick(60);

    // Three streams, three people, three parked gaps — and nothing else moves
    // until the gaps are let go.
    expect(world.posts).toHaveLength(3);
    expect(clock.parked).toHaveLength(3);

    const result = await clock.settle(running);
    expect(result.unfollowed).toBe(12);
    expect(result.stopped).toBe('end');
    // Everybody, once each, however many streams did the work.
    expect(new Set(world.posts).size).toBe(12);
  });

  it('reads the page once, not once per stream', async () => {
    const world = followingWorld(net);
    const clock = parkingSleep();

    const running = unfollowAll({ speed: 'fast' });
    await tick(60);

    expect(world.reads).toHaveLength(1);
    await clock.settle(running);
  });

  it('gaps each stream by 0.5-0.9 s rather than by the careful 0.8-1.6', async () => {
    followingWorld(net);
    const clock = parkingSleep();

    await clock.settle(unfollowAll({ speed: 'fast' }));

    expect(clock.waits.length).toBeGreaterThan(3);
    for (const ms of clock.waits) {
      expect(ms).toBeGreaterThanOrEqual(UNFOLLOW_FAST_PACING.minDelayMs);
      expect(ms).toBeLessThanOrEqual(UNFOLLOW_FAST_PACING.maxDelayMs);
    }
  });

  it('a 429 on any one stream ends all three', async () => {
    const world = followingWorld(net, (n) => (n === 2 ? 429 : null));
    const clock = parkingSleep();

    const result = await clock.settle(unfollowAll({ speed: 'fast' }));

    expect(result.stopped).toBe('error');
    expect(result.error).toMatch(/rate limited/i);
    // Only what was already in flight when LinkedIn said stop.
    expect(world.posts.length).toBeLessThanOrEqual(3);
  });

  it('never overshoots the limit, however many streams are racing for it', async () => {
    const world = followingWorld(net);
    const clock = parkingSleep();

    const result = await clock.settle(unfollowAll({ speed: 'fast', limit: 4 }));

    expect(result.unfollowed).toBe(4);
    expect(result.attempted).toBe(4);
    expect(world.posts).toHaveLength(4);
    expect(result.stopped).toBe('limit');
  });

  it('holds to a limit of one, which is the run to try first', async () => {
    const world = followingWorld(net);
    const clock = parkingSleep();

    const result = await clock.settle(unfollowAll({ speed: 'fast', limit: 1 }));

    expect(world.posts).toEqual([URNS[0]]);
    expect(result.unfollowed).toBe(1);
  });

  it('shares one limit and one seen set across both sources', async () => {
    const world = everyoneWorld(net);
    const clock = parkingSleep();

    const result = await clock.settle(unfollowAll({ scope: 'everyone', speed: 'fast', limit: 16 }));

    expect(result.unfollowed).toBe(16);
    expect(result.stopped).toBe('limit');
    expect(new Set(world.following.posts).size).toBe(16);
  });

  it('runs a preview on one stream, because a preview sends nothing', async () => {
    const world = followingWorld(net);

    const result = await unfollowAll({ speed: 'fast', dryRun: true });

    expect(result.names).toEqual(FOLLOWING);
    expect(world.posts).toEqual([]);
  });
});

/* ================================================================== */
/*  unfollowCount with scope: everyone                                */
/* ================================================================== */

describe('API mode — counting everyone', () => {
  let net;

  beforeEach(() => {
    seedSession();
    net = stubFetch();
  });

  it('adds the followers you still follow to the Following list total', async () => {
    const world = everyoneWorld(net);

    const data = await unfollowCount({ scope: 'everyone' });

    expect(data.count).toBe(18);
    expect(data.followers).toEqual({ total: 10, stillFollowing: 6 });
    // Nothing was unfollowed to find that out.
    expect(world.following.posts).toEqual([]);
    expect(net.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('reads the whole followers list, page by page', async () => {
    const world = everyoneWorld(net);

    await unfollowCount({ scope: 'everyone' });

    expect(world.followers.reads.map((r) => r.start)).toEqual([0, 6]);
  });

  it('tops the sample up from the connections the Following list never shows', async () => {
    everyoneWorld(net, { rows: FOLLOWERS });
    // Nobody on the Following list, so every name in the sample is a follower.
    net.route(
      (url) => url.includes('voyagerSearchDashClusters') && url.includes('List(PEOPLE_FOLLOW)'),
      {
        data: {
          data: {
            searchDashClustersByAll: { metadata: { totalResultCount: 0 }, elements: [] },
          },
          errors: [],
        },
        included: [],
      },
    );

    const data = await unfollowCount({ scope: 'everyone' });

    expect(data.count).toBe(6);
    expect(data.sample).toEqual(STILL_FOLLOWED);
  });

  it('announces the scan while it counts', async () => {
    everyoneWorld(net);

    await unfollowCount({ scope: 'everyone' });

    const scanning = mock()
      .messages.filter((m) => m.event === EVENTS.UNFOLLOW_PROGRESS)
      .map((m) => m.payload);
    expect(scanning).toEqual([
      { done: 6, total: 10, phase: 'scanning' },
      { done: 10, total: 10, phase: 'scanning' },
    ]);
  });

  it('is one request and no scan when the scope is left off', async () => {
    const world = everyoneWorld(net);

    const data = await unfollowCount({});

    expect(data).toEqual({ count: 12, sample: FOLLOWING.slice(0, 10) });
    expect(world.followers.reads).toEqual([]);
  });
});
