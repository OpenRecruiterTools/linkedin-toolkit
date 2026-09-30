/**
 * What a LinkedIn response actually is.
 *
 * The HTTP status alone does not say. LinkedIn's usual way of interrupting an
 * API call is not an error status at all: it *redirects* the request to an
 * HTML page — a security check, the sign-in page, the auth wall — and `fetch`
 * follows the redirect, so the caller is handed `ok: true`, `status: 200` and a
 * page of markup. Treat that as a success and an unfollow that never happened
 * is counted; treat it as "not JSON" and the person at the keyboard is told
 * nothing they can act on.
 *
 * So every response is classified here, from the five facts a caller already
 * has, before anything is parsed:
 *
 *   'ok'            a real answer from the API
 *   'challenge'     LinkedIn is asking the human to confirm it is them
 *   'signed_out'    there is no session: sign in again
 *   'rate_limited'  429 or 999
 *   'error'         anything else that is not an answer
 *
 * This module recognises a security check. It does nothing about one. There is
 * no solver here, no retry and no alternate route, and there never will be:
 * the only thing a caller may do with `'challenge'` is stop, tell the human,
 * and wait for them.
 *
 * Pure: no `fetch`, no `chrome`, no DOM. The same file ships in LinkedIn
 * Toolkit and in LinkedIn Unfollow.
 */

export const RESPONSE = Object.freeze({
  OK: 'ok',
  CHALLENGE: 'challenge',
  SIGNED_OUT: 'signed_out',
  RATE_LIMITED: 'rate_limited',
  ERROR: 'error',
});

/** How much of a body is looked at. A check page says what it is at the top. */
export const SNIPPET_LENGTH = 2048;

/** Words on a page that mean LinkedIn wants the human, in lower case. */
export const CHALLENGE_MARKERS = Object.freeze([
  'captcha',
  'security verification',
  'security check',
  "verify you're human",
  "let's do a quick security check",
  'unusual activity',
  'checkpoint',
]);

/** Words on a page that mean nobody is signed in, in lower case. */
export const SIGNED_OUT_MARKERS = Object.freeze(['sign in', 'join linkedin']);

/** Where LinkedIn sends a request that has no session behind it. */
export const SIGNED_OUT_PATHS = Object.freeze(['/uas/login', '/login', '/authwall', '/m/login']);

/**
 * The path of a URL, lower-cased, and nothing else.
 *
 * Only the path is ever matched. A perfectly ordinary API call can carry the
 * word "challenge" in its query string, and that must not stop a run.
 */
function pathnameOf(url) {
  if (!url) return '';
  try {
    return new URL(String(url), 'https://www.linkedin.com').pathname.toLowerCase();
  } catch {
    return '';
  }
}

/** The first 2 KB, lower-cased, with the apostrophes a page may spell three ways made one. */
function normalise(bodySnippet) {
  return String(bodySnippet == null ? '' : bodySnippet)
    .slice(0, SNIPPET_LENGTH)
    .toLowerCase()
    .replace(/&#39;|&#x27;|&apos;|[‘’]/g, "'");
}

/**
 * The keys at the top level of a JSON object, each with the start of its value.
 *
 * A snippet is the first 2 KB of a body, so it is very often cut off mid-way
 * and `JSON.parse` would throw. This walks the text instead, counting braces,
 * and only reports a key it met at depth one — a `challengeUrl` buried inside
 * somebody's profile data is not LinkedIn talking to us.
 *
 * @param {string} text already lower-cased
 * @returns {Record<string, string>}
 */
function topLevelKeys(text) {
  const found = {};
  if (!text.trimStart().startsWith('{')) return found;

  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      let str = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') j += 1;
        if (j < text.length) str += text[j];
        j += 1;
      }
      let k = j + 1;
      while (k < text.length && /\s/.test(text[k])) k += 1;
      if (depth === 1 && text[k] === ':') {
        const value = /^\s*"?(-?[\w.]*)/.exec(text.slice(k + 1, k + 40));
        found[str] = value ? value[1] : '';
      }
      i = j + 1;
      continue;
    }
    if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') depth -= 1;
    i += 1;
  }
  return found;
}

/**
 * A JSON body that is itself LinkedIn asking for a check: a top-level
 * `challengeUrl` / `challenge_url`, or a 403 — on the status line or as the
 * body's own top-level `status` — whose body mentions a challenge.
 */
function jsonAsksForCheck(snippet, status) {
  const keys = topLevelKeys(snippet);
  if (!Object.keys(keys).length) return false;
  // Keys are compared lower-cased, because the snippet was.
  if ('challengeurl' in keys || 'challenge_url' in keys) return true;
  const refused = status === 403 || Number(keys.status) === 403;
  return refused && snippet.includes('challenge');
}

/** Markup, by its content type or — when a response carries none — by how it starts. */
function isHtml(contentType, snippet) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('text/html') || type.includes('application/xhtml')) return true;
  if (type) return false;
  const start = snippet.trimStart();
  return start.startsWith('<!doctype html') || start.startsWith('<html');
}

/** JSON, by its content type or by how it starts. */
function isJson(contentType, snippet) {
  if (String(contentType || '').toLowerCase().includes('json')) return true;
  const start = snippet.trimStart();
  return start.startsWith('{') || start.startsWith('[');
}

/**
 * Classify one response, and say which rule decided it.
 *
 * The rules, in order — the first that matches wins:
 *
 *   1. final URL path starts with `/checkpoint/` or contains `/challenge`  → challenge
 *   2. final URL path starts with `/uas/login`, `/login`, `/authwall`
 *      or `/m/login`                                                       → signed_out
 *   3. status 451                                                          → challenge
 *   4. status 401                                                          → signed_out
 *   5. status 429 or 999                                                   → rate_limited
 *   6. a JSON body with a top-level `challengeUrl` / `challenge_url`, or
 *      a 403 whose JSON body mentions a challenge                          → challenge
 *   7. any other status outside 2xx                                        → error
 *   8. a 2xx that is HTML (we always ask for JSON): a challenge marker in
 *      the first 2 KB → challenge; else "sign in" / "join linkedin"
 *      → signed_out; else                                                  → error
 *   9. a 2xx that was redirected and has a body that is not JSON           → error
 *  10. everything left — a 2xx that is JSON, or empty                      → ok
 *
 * @param {{status?: number, url?: string, redirected?: boolean,
 *   contentType?: string, bodySnippet?: string}} response
 * @returns {{kind: string, rule: string}} `rule` is one of `path`, `status`,
 *   `json`, `html`, `redirect`, `none`
 */
export function explainResponse(response = {}) {
  const { status, url, redirected, contentType, bodySnippet } = response || {};
  const path = pathnameOf(url);

  if (path === '/checkpoint' || path.startsWith('/checkpoint/') || path.includes('/challenge')) {
    return { kind: RESPONSE.CHALLENGE, rule: 'path' };
  }
  if (SIGNED_OUT_PATHS.some((prefix) => path.startsWith(prefix))) {
    return { kind: RESPONSE.SIGNED_OUT, rule: 'path' };
  }

  const code = Number(status);
  if (code === 451) return { kind: RESPONSE.CHALLENGE, rule: 'status' };
  if (code === 401) return { kind: RESPONSE.SIGNED_OUT, rule: 'status' };
  if (code === 429 || code === 999) return { kind: RESPONSE.RATE_LIMITED, rule: 'status' };

  const snippet = normalise(bodySnippet);
  if (jsonAsksForCheck(snippet, code)) return { kind: RESPONSE.CHALLENGE, rule: 'json' };

  if (!(code >= 200 && code < 300)) return { kind: RESPONSE.ERROR, rule: 'status' };

  if (isHtml(contentType, snippet)) {
    if (CHALLENGE_MARKERS.some((marker) => snippet.includes(marker))) {
      return { kind: RESPONSE.CHALLENGE, rule: 'html' };
    }
    if (SIGNED_OUT_MARKERS.some((marker) => snippet.includes(marker))) {
      return { kind: RESPONSE.SIGNED_OUT, rule: 'html' };
    }
    return { kind: RESPONSE.ERROR, rule: 'html' };
  }

  // Sent somewhere else and handed something that is not data: not an answer.
  if (redirected && snippet.trim() && !isJson(contentType, snippet)) {
    return { kind: RESPONSE.ERROR, rule: 'redirect' };
  }

  return { kind: RESPONSE.OK, rule: 'none' };
}

/**
 * Classify one response.
 *
 * @param {{status?: number, url?: string, redirected?: boolean,
 *   contentType?: string, bodySnippet?: string}} response
 * @returns {'ok'|'challenge'|'signed_out'|'rate_limited'|'error'}
 */
export function classifyResponse(response = {}) {
  return explainResponse(response).kind;
}

/**
 * The five facts, read off a `fetch` Response and the text of its body.
 *
 * Defensive on purpose: `headers`, `url` and `redirected` are all absent on the
 * hand-rolled responses tests pass in, and absent must mean "no evidence", not
 * a thrown TypeError in the middle of a run.
 *
 * @param {object} resp a `Response`, or the part of one a caller has
 * @param {string} [bodyText] the body, already read
 * @param {string} [requestUrl] used when the response does not say where it ended up
 */
export function responseFacts(resp, bodyText = '', requestUrl = '') {
  const headers = resp && resp.headers;
  let contentType = '';
  if (headers && typeof headers.get === 'function') {
    contentType = headers.get('content-type') || headers.get('Content-Type') || '';
  }
  return {
    status: resp ? resp.status : 0,
    url: (resp && resp.url) || requestUrl || '',
    redirected: !!(resp && resp.redirected),
    contentType: String(contentType || ''),
    bodySnippet: String(bodyText == null ? '' : bodyText).slice(0, SNIPPET_LENGTH),
  };
}
