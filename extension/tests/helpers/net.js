/**
 * Test helper: a recording stub for `fetch` plus a logged-in LinkedIn session.
 *
 * Everything is offline. `seedSession()` puts a JSESSIONID cookie in the chrome
 * mock so `voyagerFetch` can build its CSRF header; `stubFetch()` answers each
 * call from a queue and records the URL, method, headers and body.
 */
import { vi } from 'vitest';

import me from '../fixtures/voyager/me.json';
import profileExperience from '../fixtures/voyager/profileExperience.json';

export function seedSession(value = 'ajax:1234567890') {
  chrome.__mock.cookies.set('JSESSIONID', { name: 'JSESSIONID', value: `"${value}"` });
  chrome.__mock.cookies.set('li_at', { name: 'li_at', value: 'AQED-token' });
  return value;
}

/**
 * Install a fetch stub.
 * @param {Array<object|Function>} responses queued replies; each is a body
 *   object, or `{ status, body }`, or a function of (url, init)
 * @returns {{calls: object[], push: (r: any) => void}}
 */
export function stubFetch(responses = []) {
  const queue = [...responses];
  const calls = [];
  /** Persistent URL-matched responders, checked before the queue. */
  const routes = [];

  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const call = {
      url: String(url),
      method: (init.method || 'GET').toUpperCase(),
      headers: init.headers || {},
      body: init.body,
      credentials: init.credentials,
    };
    try {
      call.json = init.body ? JSON.parse(init.body) : undefined;
    } catch {
      call.json = undefined;
    }
    calls.push(call);

    const route = routes.find((r) => r.match(call.url));
    let reply = route ? route.body : queue.length ? queue.shift() : {};
    if (typeof reply === 'function') reply = reply(call.url, init);
    call.redirect = init.redirect;

    // A reply that says where it ended up and what it is — see `landed()`.
    if (reply && reply.__landed) {
      const raw = reply.__landed;
      const code = raw.status === undefined ? 200 : raw.status;
      const bodyText = raw.text === undefined ? '' : raw.text;
      return {
        ok: code >= 200 && code < 300,
        status: code,
        statusText: String(code),
        url: raw.url === undefined ? call.url : raw.url,
        redirected: !!raw.redirected,
        headers: new Headers(raw.contentType ? { 'content-type': raw.contentType } : {}),
        text: async () => bodyText,
        json: async () => JSON.parse(bodyText),
      };
    }

    const status = reply && reply.__status ? reply.__status : 200;
    const body = reply && reply.__status ? reply.body : reply;
    const text = body === undefined ? '' : JSON.stringify(body);

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      text: async () => text,
      json: async () => body,
    };
  });

  return {
    calls,
    push: (r) => queue.push(r),
    /**
     * Answer any URL containing `match` (or matching a predicate) with `body`,
     * without consuming the queue. A later route wins over an earlier one, so a
     * test can override a default set up in `beforeEach`.
     */
    route(match, body) {
      const predicate = typeof match === 'function' ? match : (url) => url.includes(match);
      routes.unshift({ match: predicate, body });
    },
    last: () => calls[calls.length - 1],
    /** Query params of the nth (default last) call. */
    query(n = -1) {
      const call = n < 0 ? calls[calls.length + n] : calls[n];
      return new URL(call.url).searchParams;
    },
  };
}

/** `{ __status, body }` marker for a non-200 reply. */
export function status(code, body = {}) {
  return { __status: code, body };
}

/**
 * A reply shaped like a real `Response` after `fetch` has followed a redirect:
 * it carries the URL it ended up at, whether it was redirected, a content type
 * and a raw text body. This is what a LinkedIn security check looks like from
 * the inside — `200 OK`, `text/html`, somewhere other than where we asked.
 *
 * @param {{status?: number, url?: string, redirected?: boolean,
 *   contentType?: string, text?: string}} raw
 */
export function landed(raw = {}) {
  return { __landed: raw };
}

/** An invented stand-in for LinkedIn's check page. Not a capture of a real one. */
export const CHECK_PAGE_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Security Verification | LinkedIn</title></head>' +
  '<body><h1>Let\'s do a quick security check</h1><div id="captcha-internal"></div></body></html>';

/** An invented stand-in for LinkedIn's sign-in page. */
export const SIGN_IN_PAGE_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>LinkedIn Login, Sign in | LinkedIn</title></head>' +
  '<body><h1>Sign in</h1><p>New to LinkedIn? Join LinkedIn now</p></body></html>';

/** Redirected to the checkpoint, the way an interrupted XHR comes back. */
export function checkpointRedirect(path = '/checkpoint/challenge/AgEXAMPLEONLY?ut=invented') {
  return landed({
    status: 200,
    url: `https://www.linkedin.com${path}`,
    redirected: true,
    contentType: 'text/html; charset=utf-8',
    text: CHECK_PAGE_HTML,
  });
}

/** Redirected to the sign-in page, the way a request with no session comes back. */
export function loginRedirect(path = '/uas/login?session_redirect=%2Fvoyager%2Fapi%2Fme') {
  return landed({
    status: 200,
    url: `https://www.linkedin.com${path}`,
    redirected: true,
    contentType: 'text/html; charset=utf-8',
    text: SIGN_IN_PAGE_HTML,
  });
}

/**
 * Answer the two calls the engine now makes around a headline action, so a
 * test can keep queueing only the response it actually cares about.
 *
 * `/me` backs every messaging call (the mailbox is us) and the profile
 * components query backs every profile read (LinkedIn serves no positions on
 * the profile decorations any more). Both are routes rather than queued
 * replies, so they never shift the queue a test set up.
 */
export function routeBackground(net) {
  net.route('/voyager/api/me', me);
  net.route('voyagerIdentityDashProfileComponents', profileExperience);
  return net;
}
