/**
 * LinkedIn Toolkit — Voyager transport.
 *
 * CSRF, the authenticated fetch, and the mapping from LinkedIn's stand-down
 * responses onto contract error codes and the quota module's backoff state.
 * Everything runs in the user's own logged-in Chrome; nothing here stores
 * credentials.
 */

import { ERROR, EngineError } from '../lib/actions.js';
import { noteBackoff, pauseState } from './quota.js';

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
    throw new EngineError(
      ERROR.CHALLENGE_DETECTED,
      'LinkedIn security challenge detected — complete it, then clear the challenge.',
    );
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
  451: [
    ERROR.CHALLENGE_DETECTED,
    'LinkedIn security challenge detected. Open LinkedIn and complete it.',
  ],
  999: [ERROR.RATE_LIMITED, 'LinkedIn returned 999 (bot defence). Pausing for an hour.'],
};

/* ------------------------------------------------------------------ */
/*  Fetch                                                             */
/* ------------------------------------------------------------------ */

/**
 * Authenticated request to LinkedIn.
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

  const init = { ...options, headers, credentials: 'include' };
  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
    // A caller may pin an exact content-type — the invitation write sends the
    // `; charset=UTF-8` spelling the web client sends — so only fill it in.
    if (!headers['content-type']) headers['content-type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }

  const resp = await fetch(url, init);

  if (!resp.ok) {
    const known = STATUS_ERROR[resp.status];
    if (resp.status === 429 || resp.status === 451 || resp.status === 999 || resp.status === 403) {
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

    let body = '';
    try {
      body = await resp.text();
    } catch {
      /* body is optional */
    }
    const error = new EngineError(
      ERROR.LINKEDIN_ERROR,
      `Voyager API error ${resp.status}: ${body.slice(0, 300)}`,
    );
    // LinkedIn explains a refused write in the body — `{"data":{"code":…,
    // "message":…}}` for a duplicate invitation or an exhausted allowance — so
    // the parsed body rides along for a caller that can turn it into a real
    // explanation. It hangs off the error itself rather than off `extra`, which
    // is folded into the response envelope: raw LinkedIn JSON is ours to read,
    // not something to hand to every client.
    error.status = resp.status;
    try {
      if (body) error.response = JSON.parse(body);
    } catch {
      /* not JSON; the message already carries the text */
    }
    throw error;
  }

  if (resp.status === 204) return { ok: true };
  const text = await resp.text();
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
