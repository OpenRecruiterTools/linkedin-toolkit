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
