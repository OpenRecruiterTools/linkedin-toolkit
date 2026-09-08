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
    ...(options.headers || {}),
  };

  const init = { ...options, headers, credentials: 'include' };
  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }

  const resp = await fetch(url, init);

  if (!resp.ok) {
    const known = STATUS_ERROR[resp.status];
    if (resp.status === 429 || resp.status === 451 || resp.status === 999 || resp.status === 403) {
      await noteBackoff(resp.status);
    }
    if (known) throw new EngineError(known[0], known[1]);

    let body = '';
    try {
      body = await resp.text();
    } catch {
      /* body is optional */
    }
    throw new EngineError(
      ERROR.LINKEDIN_ERROR,
      `Voyager API error ${resp.status}: ${body.slice(0, 300)}`,
    );
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
