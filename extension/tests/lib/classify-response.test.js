/**
 * The response classifier: every rule, in order, and the traps around them.
 *
 * Nothing here is a captured LinkedIn page. The check pages and sign-in pages
 * below are invented stand-ins carrying the phrases the classifier looks for,
 * because the shapes they stand for have been read about, not recorded — see
 * `docs/captcha-and-security-checks.md` for which are assumptions.
 */
import { describe, it, expect } from 'vitest';

import {
  CHALLENGE_MARKERS,
  RESPONSE,
  SIGNED_OUT_PATHS,
  SNIPPET_LENGTH,
  classifyResponse,
  explainResponse,
  responseFacts,
} from '../../src/lib/classify-response.js';

const API = 'https://www.linkedin.com/voyager/api';
const JSON_TYPE = 'application/vnd.linkedin.normalized+json+2.1; charset=UTF-8';
const HTML_TYPE = 'text/html; charset=utf-8';

/** A plain, healthy API answer; each test changes only what it is about. */
const answer = (over = {}) => ({
  status: 200,
  url: `${API}/graphql?queryId=voyagerSearchDashClusters.abc`,
  redirected: false,
  contentType: JSON_TYPE,
  bodySnippet: '{"data":{"data":{}},"included":[]}',
  ...over,
});

const page = (body, over = {}) =>
  answer({ contentType: HTML_TYPE, bodySnippet: `<!DOCTYPE html><html><body>${body}</body></html>`, ...over });

describe('rule 1 — the final URL is a checkpoint or a challenge', () => {
  it.each([
    'https://www.linkedin.com/checkpoint/challenge/AgEXAMPLE?ut=abc',
    'https://www.linkedin.com/checkpoint/lg/login-submit',
    'https://www.linkedin.com/checkpoint/',
    'https://www.linkedin.com/checkpoint',
    'https://www.linkedin.com/uas/challenge-page',
    'https://www.linkedin.com/Checkpoint/Challenge/UPPER',
  ])('%s is a challenge', (url) => {
    expect(classifyResponse(page('Hello', { url, redirected: true }))).toBe(RESPONSE.CHALLENGE);
  });

  it('wins over everything else the response says about itself', () => {
    const url = 'https://www.linkedin.com/checkpoint/challenge/AgEXAMPLE';
    // A checkpoint URL that answers JSON 200, or 401, or 429, is still a challenge.
    expect(classifyResponse(answer({ url, redirected: true }))).toBe(RESPONSE.CHALLENGE);
    expect(classifyResponse(answer({ url, status: 401 }))).toBe(RESPONSE.CHALLENGE);
    expect(classifyResponse(answer({ url, status: 429 }))).toBe(RESPONSE.CHALLENGE);
  });

  it('says it was the path that decided it', () => {
    const url = 'https://www.linkedin.com/checkpoint/challenge/AgEXAMPLE';
    expect(explainResponse(answer({ url }))).toEqual({ kind: 'challenge', rule: 'path' });
  });
});

describe('rule 2 — the final URL is a sign-in page', () => {
  it.each([
    'https://www.linkedin.com/uas/login?session_redirect=%2Fvoyager%2Fapi',
    'https://www.linkedin.com/login',
    'https://www.linkedin.com/login/',
    'https://www.linkedin.com/authwall?trk=x',
    'https://www.linkedin.com/m/login/',
  ])('%s is signed out', (url) => {
    expect(classifyResponse(page('Welcome back', { url, redirected: true }))).toBe(
      RESPONSE.SIGNED_OUT,
    );
  });

  it('covers exactly the four paths it was given', () => {
    expect([...SIGNED_OUT_PATHS]).toEqual(['/uas/login', '/login', '/authwall', '/m/login']);
  });

  it('beats the page text: a sign-in URL whose page mentions a security check is signed out', () => {
    const url = 'https://www.linkedin.com/uas/login';
    expect(classifyResponse(page('security check', { url }))).toBe(RESPONSE.SIGNED_OUT);
  });

  it('loses to rule 1: a checkpoint URL is a challenge even when it is the login checkpoint', () => {
    const url = 'https://www.linkedin.com/checkpoint/lg/login';
    expect(classifyResponse(page('Sign in', { url }))).toBe(RESPONSE.CHALLENGE);
  });
});

describe('rules 3 to 5 — the status line', () => {
  it('451 is a challenge', () => {
    expect(explainResponse(answer({ status: 451 }))).toEqual({ kind: 'challenge', rule: 'status' });
  });

  it('401 is signed out', () => {
    expect(explainResponse(answer({ status: 401 }))).toEqual({ kind: 'signed_out', rule: 'status' });
  });

  it.each([429, 999])('%i is a rate limit', (status) => {
    expect(classifyResponse(answer({ status }))).toBe(RESPONSE.RATE_LIMITED);
  });

  it.each([400, 403, 404, 500, 502])('%i with an ordinary body is just an error', (status) => {
    expect(classifyResponse(answer({ status, bodySnippet: '{"status":' + status + '}' }))).toBe(
      RESPONSE.ERROR,
    );
  });

  it('takes a status given as a string', () => {
    expect(classifyResponse(answer({ status: '451' }))).toBe(RESPONSE.CHALLENGE);
  });
});

describe('rule 6 — a JSON body that is itself asking for a check', () => {
  it('a top-level challengeUrl is a challenge, whatever the status', () => {
    const body = '{"challengeUrl":"https://www.linkedin.com/checkpoint/challenge/x","status":200}';
    expect(explainResponse(answer({ bodySnippet: body }))).toEqual({
      kind: 'challenge',
      rule: 'json',
    });
    expect(classifyResponse(answer({ status: 403, bodySnippet: body }))).toBe(RESPONSE.CHALLENGE);
  });

  it('so is a top-level challenge_url', () => {
    const body = '{ "challenge_url" : "https://www.linkedin.com/checkpoint/challenge/x" }';
    expect(classifyResponse(answer({ bodySnippet: body }))).toBe(RESPONSE.CHALLENGE);
  });

  it('a body whose own status is 403 and which mentions a challenge is a challenge', () => {
    const body = '{"status":403,"message":"forbidden","challenge":{"type":"CAPTCHA"}}';
    expect(classifyResponse(answer({ status: 403, bodySnippet: body }))).toBe(RESPONSE.CHALLENGE);
    // …even when the status line itself said 200.
    expect(classifyResponse(answer({ status: 200, bodySnippet: body }))).toBe(RESPONSE.CHALLENGE);
  });

  it('an HTTP 403 whose JSON mentions a challenge is a challenge', () => {
    const body = '{"message":"CHALLENGE_REQUIRED"}';
    expect(classifyResponse(answer({ status: 403, bodySnippet: body }))).toBe(RESPONSE.CHALLENGE);
  });

  it('reads a body that was cut off at 2 KB and will not parse', () => {
    const body = `{"challengeUrl":"https://www.linkedin.com/checkpoint/x","padding":"${'x'.repeat(5000)}`;
    expect(() => JSON.parse(body.slice(0, SNIPPET_LENGTH))).toThrow();
    expect(classifyResponse(answer({ bodySnippet: body }))).toBe(RESPONSE.CHALLENGE);
  });

  it('TRAP: a challengeUrl nested inside the data is not LinkedIn talking to us', () => {
    const body = '{"data":{"challengeUrl":"https://example.test/coding-challenge"},"included":[]}';
    expect(classifyResponse(answer({ bodySnippet: body }))).toBe(RESPONSE.OK);
  });

  it('TRAP: a key that only appears as somebody’s text is not a key', () => {
    const body = '{"note":"\\"challengeUrl\\": ask me about it","included":[]}';
    expect(JSON.parse(body).note).toBe('"challengeUrl": ask me about it');
    expect(classifyResponse(answer({ bodySnippet: body }))).toBe(RESPONSE.OK);
  });

  it('TRAP: a 200 that mentions a challenge, with no 403 anywhere, is an answer', () => {
    const body = '{"included":[{"headline":"I love a coding challenge"}]}';
    expect(classifyResponse(answer({ bodySnippet: body }))).toBe(RESPONSE.OK);
  });

  it('TRAP: a 403 that does not mention a challenge stays an error', () => {
    expect(classifyResponse(answer({ status: 403, bodySnippet: '{"status":403}' }))).toBe(
      RESPONSE.ERROR,
    );
  });
});

describe('rule 8 — a 2xx that is a web page, when we asked for JSON', () => {
  it.each(CHALLENGE_MARKERS.map((marker) => [marker]))('"%s" on the page is a challenge', (marker) => {
    expect(explainResponse(page(`<h1>${marker.toUpperCase()}</h1>`))).toEqual({
      kind: 'challenge',
      rule: 'html',
    });
  });

  it('looks for exactly the seven phrases it was given', () => {
    expect([...CHALLENGE_MARKERS]).toEqual([
      'captcha',
      'security verification',
      'security check',
      "verify you're human",
      "let's do a quick security check",
      'unusual activity',
      'checkpoint',
    ]);
  });

  it('reads an apostrophe however the page spelled it', () => {
    expect(classifyResponse(page('Verify you’re human'))).toBe(RESPONSE.CHALLENGE);
    expect(classifyResponse(page('Verify you&#39;re human'))).toBe(RESPONSE.CHALLENGE);
    expect(classifyResponse(page('Verify you&apos;re human'))).toBe(RESPONSE.CHALLENGE);
  });

  it.each(['Sign in to LinkedIn', 'Join LinkedIn today'])(
    '"%s" with no check on the page is signed out',
    (text) => {
      expect(explainResponse(page(text))).toEqual({ kind: 'signed_out', rule: 'html' });
    },
  );

  it('a check beats a sign-in link on the same page', () => {
    expect(classifyResponse(page('<a>Sign in</a> <h1>Security verification</h1>'))).toBe(
      RESPONSE.CHALLENGE,
    );
  });

  it('a page that says neither is an error, never ok', () => {
    expect(explainResponse(page('<h1>LinkedIn</h1>'))).toEqual({ kind: 'error', rule: 'html' });
  });

  it('only looks at the first 2 KB', () => {
    const late = page(`${' '.repeat(SNIPPET_LENGTH)}captcha`);
    expect(classifyResponse(late)).toBe(RESPONSE.ERROR);
  });

  it('knows a page by how it starts when the response names no content type', () => {
    const bare = { contentType: '' };
    expect(classifyResponse(page('Security check', bare))).toBe(RESPONSE.CHALLENGE);
    expect(classifyResponse(page('nothing to see', bare))).toBe(RESPONSE.ERROR);
    expect(
      classifyResponse(answer({ ...bare, bodySnippet: '  <html lang="en"><body>captcha</body></html>' })),
    ).toBe(RESPONSE.CHALLENGE);
  });

  it('TRAP: the same words inside a JSON answer are somebody’s profile, not a check', () => {
    const body =
      '{"included":[{"headline":"CAPTCHA engineer — security check automation, unusual activity ' +
      'detection, checkpoint firewalls. Sign in to see more. Join LinkedIn."}]}';
    expect(classifyResponse(answer({ bodySnippet: body }))).toBe(RESPONSE.OK);
  });
});

describe('the traps — what must stay ok, and what must never become ok', () => {
  it('a JSON 200 is ok', () => {
    expect(explainResponse(answer())).toEqual({ kind: 'ok', rule: 'none' });
  });

  it('a 204 with no body and no content type is ok', () => {
    expect(classifyResponse(answer({ status: 204, contentType: '', bodySnippet: '' }))).toBe(
      RESPONSE.OK,
    );
  });

  it('a 200 with an empty body is ok', () => {
    expect(classifyResponse(answer({ contentType: '', bodySnippet: '' }))).toBe(RESPONSE.OK);
  });

  it('"challenge" in the QUERY STRING of an API call does not trigger: only the path is matched', () => {
    for (const url of [
      `${API}/graphql?variables=(keywords:coding%20challenge)&queryId=x`,
      `${API}/search/blended?keywords=/checkpoint/challenge&next=/uas/login`,
      `${API}/graphql?redirect=https://www.linkedin.com/checkpoint/challenge/x#/authwall`,
    ]) {
      expect(classifyResponse(answer({ url }))).toBe(RESPONSE.OK);
    }
  });

  it('a redirect to another API path that answers JSON is ok', () => {
    expect(
      classifyResponse(answer({ redirected: true, url: `${API}/graphql?queryId=moved.def` })),
    ).toBe(RESPONSE.OK);
  });

  it('a redirect that ends on something that is neither JSON nor a page is an error', () => {
    expect(
      explainResponse(
        answer({ redirected: true, contentType: 'text/plain', bodySnippet: 'moved' }),
      ),
    ).toEqual({ kind: 'error', rule: 'redirect' });
  });

  it('a relative URL is read as a LinkedIn path', () => {
    expect(classifyResponse(answer({ url: '/checkpoint/challenge/x' }))).toBe(RESPONSE.CHALLENGE);
    expect(classifyResponse(answer({ url: '/voyager/api/me' }))).toBe(RESPONSE.OK);
  });

  it('a response it knows nothing about is an error, not ok', () => {
    expect(classifyResponse({})).toBe(RESPONSE.ERROR);
    expect(classifyResponse()).toBe(RESPONSE.ERROR);
    expect(classifyResponse({ status: 0 })).toBe(RESPONSE.ERROR);
  });

  it('only ever answers one of its five words', () => {
    const words = new Set(Object.values(RESPONSE));
    expect([...words].sort()).toEqual(['challenge', 'error', 'ok', 'rate_limited', 'signed_out']);
    for (const probe of [answer(), page('x'), answer({ status: 451 }), answer({ status: 999 }), {}]) {
      expect(words.has(classifyResponse(probe))).toBe(true);
    }
  });
});

describe('responseFacts — reading a Response without tripping over one', () => {
  it('takes the final URL, the redirect flag, the content type and the first 2 KB', () => {
    const resp = {
      status: 200,
      url: 'https://www.linkedin.com/checkpoint/challenge/x',
      redirected: true,
      headers: new Headers({ 'content-type': HTML_TYPE }),
    };
    const facts = responseFacts(resp, 'y'.repeat(5000), `${API}/me`);

    expect(facts).toEqual({
      status: 200,
      url: 'https://www.linkedin.com/checkpoint/challenge/x',
      redirected: true,
      contentType: HTML_TYPE,
      bodySnippet: 'y'.repeat(SNIPPET_LENGTH),
    });
  });

  it('falls back to the request URL, and to no evidence, on a bare response', () => {
    expect(responseFacts({ status: 200 }, '{}', `${API}/me`)).toEqual({
      status: 200,
      url: `${API}/me`,
      redirected: false,
      contentType: '',
      bodySnippet: '{}',
    });
    expect(responseFacts(null).status).toBe(0);
    expect(classifyResponse(responseFacts(null))).toBe(RESPONSE.ERROR);
  });

  it('reads headers from anything with a get()', () => {
    const headers = new Map([['content-type', JSON_TYPE]]);
    expect(responseFacts({ status: 200, headers }, '').contentType).toBe(JSON_TYPE);
  });
});
