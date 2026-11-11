/**
 * LinkedIn Toolkit — Voyager transport.
 *
 * CSRF, the authenticated fetch, and the mapping from LinkedIn's stand-down
 * responses onto contract error codes and the quota module's backoff state.
 * Everything runs in the user's own logged-in Chrome; nothing here stores
 * credentials.
 */

import { ERROR, EngineError } from '../lib/actions.js';
import { RESPONSE, explainResponse, responseFacts } from '../lib/classify-response.js';
import {
  CHALLENGE_HOW_TO_FIX,
  CHALLENGE_PAUSED_MESSAGE,
  noteBackoff,
  noteChallenge,
  pauseState,
} from './quota.js';

export const VOYAGER_BASE = 'https://www.linkedin.com/voyager/api';
export const LINKEDIN_BASE = 'https://www.linkedin.com';

/* ------------------------------------------------------------------ */
/*  Session                                                           */
/* ------------------------------------------------------------------ */

export async function getCsrfToken() {
  const cookie = await chrome.cookies.get({ url: LINKEDIN_BASE, name: 'JSESSIONID' });
  if (!cookie || !cookie.value) {
    throw new EngineError(
      ERROR.NOT_LOGGED_IN,
      'Not logged in to LinkedIn — JSESSIONID cookie not found.',
      { howToFix: 'Open linkedin.com in this browser and sign in.' },
    );
  }
  return cookie.value.replace(/"/g, '');
}

export async function isLoggedIn() {
  try {
    const cookie = await chrome.cookies.get({ url: LINKEDIN_BASE, name: 'li_at' });
    return !!(cookie && cookie.value);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Stand-down                                                        */
/* ------------------------------------------------------------------ */

/** Refuse to touch LinkedIn while a backoff or a challenge is live. */
async function assertNotPaused() {
  const state = await pauseState();
  if (state.challenge) {
    throw new EngineError(ERROR.CHALLENGE_DETECTED, CHALLENGE_PAUSED_MESSAGE, {
      howToFix: CHALLENGE_HOW_TO_FIX,
    });
  }
  if (state.backoffUntil && state.backoffUntil > Date.now()) {
    throw new EngineError(ERROR.RATE_LIMITED, 'Paused after a LinkedIn rate-limit response.', {
      retryAfter: state.backoffUntil - Date.now(),
    });
  }
}

const STATUS_ERROR = {
  401: [ERROR.NOT_LOGGED_IN, 'LinkedIn session expired. Please log in again.'],
  403: [ERROR.LINKEDIN_ERROR, 'LinkedIn denied access (403). Your session may be flagged.'],
  429: [ERROR.RATE_LIMITED, 'Rate limited by LinkedIn (429). Pausing for 15 minutes.'],
  999: [ERROR.RATE_LIMITED, 'LinkedIn returned 999 (bot defence). Pausing for an hour.'],
};

/**
 * What happened, in the words of somebody who has never heard of a 451.
 *
 * Keyed by which of the classifier's rules decided it, so the sentence says
 * what was actually seen rather than guessing.
 */
const CHALLENGE_SEEN = {
  path:
    'LinkedIn did not answer this request. It sent it to a security check page instead, ' +
    'which means LinkedIn wants you to confirm it is really you.',
  status:
    'LinkedIn security challenge detected (HTTP 451): LinkedIn refused the request and wants ' +
    'you to confirm it is really you.',
  html:
    'LinkedIn answered with a security check page instead of data, which means LinkedIn ' +
    'wants you to confirm it is really you.',
  json:
    'LinkedIn answered by asking for a security check, which means LinkedIn wants you to ' +
    'confirm it is really you.',
};

const CHALLENGE_STOPPED =
  ' Everything is paused, and it stays paused until you clear it in the popup.';

const SIGNED_OUT_SEEN = {
  path:
    'LinkedIn sent this request to its sign-in page instead of answering it: you are signed ' +
    'out of LinkedIn in this browser.',
  html:
    'LinkedIn answered with its sign-in page instead of data: you are signed out of LinkedIn ' +
    'in this browser.',
};

const SIGN_IN_HOW_TO_FIX = 'Open linkedin.com in this browser, sign in, and try again.';

/** The body, or nothing. A body that cannot be read is not worth failing over. */
async function readBody(resp) {
  if (!resp || typeof resp.text !== 'function') return '';
  try {
    return (await resp.text()) || '';
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/*  Fetch                                                             */
/* ------------------------------------------------------------------ */

/**
 * Authenticated request to LinkedIn.
 *
 * Every response is classified before it is parsed (`lib/classify-response.js`).
 * LinkedIn's usual security check is not an error status: the request is
 * redirected to an HTML page, `fetch` follows it, and what comes back is
 * `200 OK`. So the final URL, the redirect flag, the content type and the top
 * of the body are all read first, and:
 *
 *   - a **challenge** sets the challenge latch — the same one a 451 sets — and
 *     throws `CHALLENGE_DETECTED`. The next call is refused before any request
 *     leaves, and the one after that, until a person clears it in the popup.
 *     Nothing here solves a check, retries past one or tries another route.
 *   - **signed out** throws `NOT_LOGGED_IN`.
 *   - a **rate limit** backs off, as before.
 *
 * @param {string} path `/identity/...` (relative to the Voyager base) or an
 *   absolute https URL for the Sales Navigator / Recruiter APIs
 * @param {RequestInit & {body?: object}} [options]
 * @returns {Promise<any>} parsed JSON (`{ ok: true }` for 204/empty)
 */
export async function voyagerFetch(path, options = {}) {
  await assertNotPaused();

  const csrf = await getCsrfToken();
  const url = path.startsWith('http') ? path : `${VOYAGER_BASE}${path}`;

  const headers = {
    'csrf-token': csrf,
    'x-restli-protocol-version': '2.0.0',
    accept: 'application/vnd.linkedin.normalized+json+2.1',
    'x-li-lang': 'en_US',
    ...(options.headers || {}),
  };

  // `follow` is what fetch does anyway; it is spelled out because the redirect
  // is the whole point. The request is allowed to go where LinkedIn sends it,
  // and then we look at where it ended up. That is all we do with a redirect.
  const init = { ...options, headers, credentials: 'include', redirect: 'follow' };
  const isBinaryBody =
    (typeof FormData !== 'undefined' && init.body instanceof FormData) ||
    (typeof Blob !== 'undefined' && init.body instanceof Blob) ||
    (typeof ArrayBuffer !== 'undefined' && init.body instanceof ArrayBuffer) ||
    (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(init.body));
  if (init.body && typeof init.body === 'object' && !isBinaryBody) {
    // A caller may pin an exact content-type — the invitation write sends the
    // `; charset=UTF-8` spelling the web client sends — so only fill it in.
    if (!headers['content-type']) headers['content-type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }

  const resp = await fetch(url, init);
  const text = await readBody(resp);
  const verdict = explainResponse(responseFacts(resp, text, url));

  if (verdict.kind === RESPONSE.CHALLENGE) {
    await noteChallenge();
    const challenged = new EngineError(
      ERROR.CHALLENGE_DETECTED,
      `${CHALLENGE_SEEN[verdict.rule] || CHALLENGE_SEEN.html}${CHALLENGE_STOPPED}`,
      { howToFix: CHALLENGE_HOW_TO_FIX },
    );
    if (!resp.ok) challenged.status = resp.status;
    throw challenged;
  }

  if (verdict.kind === RESPONSE.SIGNED_OUT && verdict.rule !== 'status') {
    // Sent to the sign-in page, or handed it. (A plain 401 keeps the wording
    // and the status it has always had, below.)
    const out = new EngineError(
      ERROR.NOT_LOGGED_IN,
      SIGNED_OUT_SEEN[verdict.rule] || SIGNED_OUT_SEEN.html,
      { howToFix: SIGN_IN_HOW_TO_FIX },
    );
    if (!resp.ok) out.status = resp.status;
    throw out;
  }

  if (!resp.ok) {
    const known = STATUS_ERROR[resp.status];
    if (resp.status === 429 || resp.status === 999 || resp.status === 403) {
      await noteBackoff(resp.status);
    }
    if (known) {
      // The HTTP status rides along even for a status we already have a code
      // for: a caller deciding whether to stand down (mass unfollow does)
      // needs to tell a 403 from any other LINKEDIN_ERROR, and the code alone
      // cannot say which.
      const stood = new EngineError(known[0], known[1]);
      stood.status = resp.status;
      throw stood;
    }

    const error = new EngineError(
      ERROR.LINKEDIN_ERROR,
      `Voyager API error ${resp.status}: ${text.slice(0, 300)}`,
    );
    // LinkedIn explains a refused write in the body — `{"data":{"code":…,
    // "message":…}}` for a duplicate invitation or an exhausted allowance — so
    // the parsed body rides along for a caller that can turn it into a real
    // explanation. It hangs off the error itself rather than off `extra`, which
    // is folded into the response envelope: raw LinkedIn JSON is ours to read,
    // not something to hand to every client.
    error.status = resp.status;
    try {
      if (text) error.response = JSON.parse(text);
    } catch {
      /* not JSON; the message already carries the text */
    }
    throw error;
  }

  if (verdict.kind !== RESPONSE.OK) {
    // A 2xx that is not an answer: a web page with nothing on it we recognise,
    // or a redirect that ended somewhere that does not speak JSON.
    throw new EngineError(
      ERROR.LINKEDIN_ERROR,
      'LinkedIn returned a web page instead of data, and not one the toolkit recognises. ' +
        'Nothing was assumed to have happened.',
      { howToFix: 'Open LinkedIn in this browser and see whether it is asking you for something.' },
    );
  }

  const method = String(init.method || 'GET').toUpperCase();
  if (resp.redirected && method !== 'GET') {
    // A redirected write is never a success. A redirect can turn a POST into a
    // GET on the way, so a 200 at the far end says nothing about whether the
    // write happened — and counting it would be inventing a result.
    throw new EngineError(
      ERROR.LINKEDIN_ERROR,
      'LinkedIn redirected this request instead of carrying it out, so it was not counted as done.',
      { howToFix: 'Open LinkedIn in this browser and check whether the action went through.' },
    );
  }

  if (resp.status === 204) return { ok: true };
  if (!text) return { ok: true };
  try {
    return JSON.parse(text);
  } catch {
    throw new EngineError(ERROR.LINKEDIN_ERROR, 'LinkedIn returned a non-JSON response.');
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

export function generateTrackingId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The messaging web client sends its 16 random bytes as a binary string. */
export function generateMessageTrackingId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return String.fromCharCode(...bytes);
}

/** Build a query string, dropping undefined/null/'' values. */
export function qs(params) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    out.set(k, String(v));
  }
  return out.toString();
}

/* ------------------------------------------------------------------ */
/*  GraphQL                                                           */
/* ------------------------------------------------------------------ */

/**
 * Encode one value the way Rest.li 2.0 wants it inside a `variables=(…)`
 * string.
 *
 * `(`, `)`, `,` and `:` are the *syntax* — this function writes them — so
 * inside a value they are percent-encoded like everything else. A urn
 * therefore goes on the wire as `urn%3Ali%3Aactivity%3A7501…`, which is what
 * LinkedIn's own client sends; leaving the colons literal is accepted by some
 * endpoints and answered with a 400 by others (`voyagerSocialDashReactions`
 * and the whole messaging surface), so there is one rule and no exceptions.
 *
 * `encodeURIComponent` leaves `!'()*` alone, so those are finished by hand.
 * `URLSearchParams` cannot be used for any of this: it would escape the
 * parentheses this function writes, and LinkedIn would reject the request.
 */
export function encodeValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `List(${value.map(encodeValue).join(',')})`;
  if (typeof value === 'object') return encodeVariables(value);
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * `{ start: 0, query: { keywords: 'head of talent' } }` →
 * `(start:0,query:(keywords:head%20of%20talent))`.
 *
 * Keys whose value is `undefined`, `null` or `''` are dropped, so a caller can
 * pass an optional filter without building the string conditionally.
 */
export function encodeVariables(variables) {
  const parts = [];
  for (const [key, value] of Object.entries(variables || {})) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}:${encodeValue(value)}`);
  }
  return `(${parts.join(',')})`;
}

/**
 * A Voyager GraphQL call.
 *
 * `includeWebMetadata` is off by default. The LinkedIn web app sends it on
 * some queries and not others, and the ones that do not want it answer 400
 * when it is there — so it is opt-in per endpoint, from a capture that
 * actually carried it.
 *
 * @param {string} queryId the persisted-query id, from `ENDPOINTS.queryIds`
 * @param {object} variables encoded with `encodeVariables`
 * @param {{includeWebMetadata?: boolean, path?: string}} [options]
 */
export async function graphql(queryId, variables, options = {}) {
  const { includeWebMetadata = false, path = '/graphql' } = options;
  const parts = [];
  if (includeWebMetadata) parts.push('includeWebMetadata=true');
  parts.push(`variables=${encodeVariables(variables)}`);
  parts.push(`queryId=${queryId}`);
  return voyagerFetch(`${path}?${parts.join('&')}`);
}

/**
 * The messaging GraphQL surface, which lives on its own path and puts the
 * queryId first.
 */
export async function messagingGraphql(queryId, variables) {
  return voyagerFetch(
    `/voyagerMessagingGraphQL/graphql?queryId=${queryId}&variables=${encodeVariables(variables)}`,
  );
}
