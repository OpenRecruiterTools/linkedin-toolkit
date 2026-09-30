/**
 * The transport, when LinkedIn interrupts it.
 *
 * LinkedIn's usual security check on an API call is a *redirect* to an HTML
 * page, which `fetch` follows: `ok: true`, `status: 200`, `redirected: true`,
 * `content-type: text/html`. These tests hand `voyagerFetch` exactly that, from
 * a stub, and assert the only acceptable behaviour: recognise it, set the
 * latch, say plainly what happened, and send nothing more until a human clears
 * it.
 *
 * Nothing here touches LinkedIn, and the pages are invented stand-ins — nobody
 * has recorded a live check for this. What is under test is what the engine
 * does once the classifier says "challenge", not what LinkedIn's page says.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { voyagerFetch } from '../../src/background/voyager-core.js';
import * as quota from '../../src/background/quota.js';
import { ERROR, EVENTS } from '../../src/lib/actions.js';
import {
  CHECK_PAGE_HTML,
  SIGN_IN_PAGE_HTML,
  checkpointRedirect,
  landed,
  loginRedirect,
  seedSession,
  status,
  stubFetch,
} from '../helpers/net.js';

const HTML = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/vnd.linkedin.normalized+json+2.1';

let net;

beforeEach(() => {
  seedSession();
  net = stubFetch();
});

const caught = (promise) => promise.then(() => null, (e) => e);
const challengeEvents = () =>
  chrome.__mock.messages.filter((m) => m && m.event === EVENTS.CHALLENGE_DETECTED);

describe('voyagerFetch — every request', () => {
  it('follows redirects explicitly, so it can see where it ended up', async () => {
    net.push({ ok: 1 });
    await voyagerFetch('/me');
    expect(net.calls[0].redirect).toBe('follow');
  });

  it('still parses an ordinary JSON answer', async () => {
    net.push(landed({ contentType: JSON_TYPE, text: '{"hello":"world"}' }));
    expect(await voyagerFetch('/me')).toEqual({ hello: 'world' });
  });

  it('still answers { ok: true } for a 204 and for an empty 200', async () => {
    net.push(landed({ status: 204 }));
    net.push(landed({ status: 200, text: '' }));
    expect(await voyagerFetch('/a')).toEqual({ ok: true });
    expect(await voyagerFetch('/b')).toEqual({ ok: true });
  });
});

describe('voyagerFetch — redirected to a security check', () => {
  it('throws CHALLENGE_DETECTED and says what happened in plain words', async () => {
    net.push(checkpointRedirect());

    const error = await caught(voyagerFetch('/me'));

    expect(error.code).toBe(ERROR.CHALLENGE_DETECTED);
    expect(error.message).toMatch(/security check page/i);
    expect(error.message).toMatch(/confirm it is really you/i);
    expect(error.message).toMatch(/paused/i);
    expect(error.message).not.toMatch(/non-JSON/i);
    expect(error.extra.howToFix).toMatch(/complete the check yourself/i);
    expect(error.extra.howToFix).toMatch(/never try to solve or get round/i);
  });

  it('sets the challenge latch — the same one a 451 sets — and announces it once', async () => {
    expect((await quota.pauseState()).challenge).toBeUndefined();
    net.push(checkpointRedirect());

    await caught(voyagerFetch('/me'));

    const state = await quota.pauseState();
    expect(state.challenge.detectedAt).toBeTypeOf('number');
    expect(challengeEvents()).toHaveLength(1);
  });

  it('blocks the next call before any request leaves', async () => {
    net.push(checkpointRedirect());
    await caught(voyagerFetch('/me'));
    expect(net.calls).toHaveLength(1);

    const second = await caught(voyagerFetch('/identity/dash/profiles'));
    const third = await caught(voyagerFetch('/feed/dash/followingStates/x', { method: 'POST' }));

    expect(second.code).toBe(ERROR.CHALLENGE_DETECTED);
    expect(third.code).toBe(ERROR.CHALLENGE_DETECTED);
    expect(second.message).toMatch(/security check/i);
    // Nothing was retried, and nothing else was sent: still the one request.
    expect(net.calls).toHaveLength(1);
    expect(challengeEvents()).toHaveLength(1);
  });

  it('blocks the quota gate too, so no write can be reserved', async () => {
    net.push(checkpointRedirect());
    await caught(voyagerFetch('/me'));

    for (const kind of quota.KINDS) {
      // eslint-disable-next-line no-await-in-loop
      expect((await caught(quota.check(kind))).code).toBe(ERROR.CHALLENGE_DETECTED);
    }
  });

  it('does not clear itself with time, and sends again only once a person clears it', async () => {
    net.push(checkpointRedirect());
    await caught(voyagerFetch('/me'));

    // Nothing in the engine waits a challenge out. Only clearChallenge() — the
    // button in the popup — lets a request leave again.
    await quota.clearChallenge();
    net.push({ fine: true });

    expect(await voyagerFetch('/me')).toEqual({ fine: true });
    expect(net.calls).toHaveLength(2);
  });

  it.each([
    ['/checkpoint/lg/login-submit'],
    ['/checkpoint/challenge/AgEXAMPLEONLY'],
    ['/uas/challenge'],
  ])('recognises %s', async (path) => {
    net.push(checkpointRedirect(path));
    expect((await caught(voyagerFetch('/me'))).code).toBe(ERROR.CHALLENGE_DETECTED);
    expect((await quota.pauseState()).challenge).toBeTruthy();
  });

  it('a redirected write is a challenge, not a success', async () => {
    net.push(checkpointRedirect());

    const error = await caught(
      voyagerFetch('/feed/dash/followingStates/urn', {
        method: 'POST',
        body: { patch: { $set: { following: false } } },
      }),
    );

    expect(error.code).toBe(ERROR.CHALLENGE_DETECTED);
  });
});

describe('voyagerFetch — a check page that arrives without a redirect', () => {
  it('an HTML 200 carrying a check is a challenge, and sets the latch', async () => {
    net.push(landed({ contentType: HTML, text: CHECK_PAGE_HTML }));

    const error = await caught(voyagerFetch('/me'));

    expect(error.code).toBe(ERROR.CHALLENGE_DETECTED);
    expect(error.message).toMatch(/security check page instead of data/i);
    expect((await quota.pauseState()).challenge).toBeTruthy();

    expect((await caught(voyagerFetch('/me'))).code).toBe(ERROR.CHALLENGE_DETECTED);
    expect(net.calls).toHaveLength(1);
  });

  it('a JSON body carrying a challengeUrl is a challenge', async () => {
    net.push(
      landed({
        contentType: JSON_TYPE,
        text: '{"challengeUrl":"https://www.linkedin.com/checkpoint/challenge/x"}',
      }),
    );

    const error = await caught(voyagerFetch('/me'));

    expect(error.code).toBe(ERROR.CHALLENGE_DETECTED);
    expect(error.message).toMatch(/asking for a security check/i);
    expect((await quota.pauseState()).challenge).toBeTruthy();
  });

  it('a 403 whose body names a challenge is a challenge, with its status', async () => {
    net.push(status(403, { status: 403, challenge: { type: 'invented' } }));

    const error = await caught(voyagerFetch('/me'));

    expect(error.code).toBe(ERROR.CHALLENGE_DETECTED);
    expect(error.status).toBe(403);
  });

  it('an HTML 200 it does not recognise is an error — never a success, never a latch', async () => {
    net.push(landed({ contentType: HTML, text: '<!DOCTYPE html><html><body>LinkedIn</body></html>' }));

    const error = await caught(voyagerFetch('/me'));

    expect(error.code).toBe(ERROR.LINKEDIN_ERROR);
    expect(error.message).toMatch(/web page instead of data/i);
    expect((await quota.pauseState()).challenge).toBeUndefined();
  });
});

describe('voyagerFetch — signed out', () => {
  it.each([['/uas/login?session_redirect=x'], ['/login'], ['/authwall?trk=x'], ['/m/login/']])(
    'a redirect to %s is NOT_LOGGED_IN',
    async (path) => {
      net.push(loginRedirect(path));

      const error = await caught(voyagerFetch('/me'));

      expect(error.code).toBe(ERROR.NOT_LOGGED_IN);
      expect(error.message).toMatch(/sign-in page/i);
      expect(error.message).toMatch(/signed out/i);
      expect(error.extra.howToFix).toMatch(/sign in/i);
    },
  );

  it('does not set the challenge latch: signing in again is all it takes', async () => {
    net.push(loginRedirect());
    await caught(voyagerFetch('/me'));

    expect((await quota.pauseState()).challenge).toBeUndefined();

    net.push({ back: true });
    expect(await voyagerFetch('/me')).toEqual({ back: true });
  });

  it('an HTML 200 that is the sign-in page is NOT_LOGGED_IN', async () => {
    net.push(landed({ contentType: HTML, text: SIGN_IN_PAGE_HTML }));

    const error = await caught(voyagerFetch('/me'));

    expect(error.code).toBe(ERROR.NOT_LOGGED_IN);
    expect(error.message).toMatch(/sign-in page instead of data/i);
  });

  it('a 401 is what it always was', async () => {
    net.push(status(401));

    const error = await caught(voyagerFetch('/me'));

    expect(error.code).toBe(ERROR.NOT_LOGGED_IN);
    expect(error.message).toBe('LinkedIn session expired. Please log in again.');
    expect(error.status).toBe(401);
  });
});

describe('voyagerFetch — the statuses it already knew', () => {
  it('a 451 sets the latch and carries its status', async () => {
    net.push(status(451));

    const error = await caught(voyagerFetch('/me'));

    expect(error.code).toBe(ERROR.CHALLENGE_DETECTED);
    expect(error.status).toBe(451);
    expect(error.message).toMatch(/security challenge/i);
    expect((await quota.pauseState()).challenge).toBeTruthy();
  });

  it.each([
    [429, ERROR.RATE_LIMITED],
    [999, ERROR.RATE_LIMITED],
    [403, ERROR.LINKEDIN_ERROR],
  ])('a %i backs off without a challenge', async (code, expected) => {
    net.push(status(code));

    const error = await caught(voyagerFetch('/me'));

    expect(error.code).toBe(expected);
    expect(error.status).toBe(code);
    const state = await quota.pauseState();
    expect(state.backoffUntil).toBeGreaterThan(Date.now());
    expect(state.challenge).toBeUndefined();
  });

  it('a 400 still hands its parsed body to the caller', async () => {
    net.push(status(400, { data: { code: 'CANT_RESEND_YET' } }));

    const error = await caught(voyagerFetch('/me'));

    expect(error.code).toBe(ERROR.LINKEDIN_ERROR);
    expect(error.response).toEqual({ data: { code: 'CANT_RESEND_YET' } });
  });
});

describe('voyagerFetch — redirects that are not a check', () => {
  it('a read redirected to another API path is an answer', async () => {
    net.push(
      landed({
        redirected: true,
        url: 'https://www.linkedin.com/voyager/api/graphql?queryId=moved.abc',
        contentType: JSON_TYPE,
        text: '{"moved":true}',
      }),
    );

    expect(await voyagerFetch('/graphql?queryId=old.abc')).toEqual({ moved: true });
  });

  it('a redirected WRITE is never counted as done, even when JSON comes back', async () => {
    net.push(
      landed({
        redirected: true,
        url: 'https://www.linkedin.com/voyager/api/feed/dash/somewhere-else',
        contentType: JSON_TYPE,
        text: '{}',
      }),
    );

    const error = await caught(voyagerFetch('/feed/dash/followingStates/urn', { method: 'POST' }));

    expect(error.code).toBe(ERROR.LINKEDIN_ERROR);
    expect(error.message).toMatch(/redirected this request instead of carrying it out/i);
  });

  it('"challenge" in a query string stops nothing', async () => {
    net.push(landed({ contentType: JSON_TYPE, text: '{"results":[]}' }));

    expect(
      await voyagerFetch('/graphql?variables=(keywords:coding%20challenge)&queryId=x'),
    ).toEqual({ results: [] });
    expect((await quota.pauseState()).challenge).toBeUndefined();
  });
});
