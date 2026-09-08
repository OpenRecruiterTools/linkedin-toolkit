/**
 * LinkedIn Toolkit — optional host permissions.
 *
 * An MV3 service worker may only `fetch` an origin the extension holds a host
 * permission for. LinkedIn is granted at install time; every other host — the
 * AI provider the user picks, an enrichment provider, a local model server —
 * is an *optional* permission the user grants at the moment they choose it, so
 * installing the extension never asks for access to the whole web.
 *
 * A missing grant looks exactly like a network failure at the fetch, so
 * callers check first and say something useful instead.
 */

/**
 * `https://api.anthropic.com/v1/messages` → `https://api.anthropic.com/*`.
 *
 * The host part of a Chrome match pattern is a *hostname*: a port makes the
 * whole pattern invalid and `chrome.permissions.request` rejects it. So a
 * local model server on `http://box.local:1234/v1` is granted as
 * `http://box.local/*`, which is what Chrome accepts and what the manifest's
 * `http://127.0.0.1/*` already looks like.
 */
export function originPatternFor(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return '';
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return '';
  }
}

/** True when the extension may already fetch this URL. */
export async function hasHostAccess(url) {
  const origins = originPatternFor(url);
  if (!origins) return false;
  if (!chrome.permissions || !chrome.permissions.contains) return true;
  try {
    return await chrome.permissions.contains({ origins: [origins] });
  } catch {
    return false;
  }
}

/**
 * Ask for access. Chrome requires a user gesture, so this may only be called
 * straight out of a click handler in the popup or the options page.
 * @returns {Promise<boolean>} whether the user granted it
 */
export async function requestHostAccess(url) {
  const origins = originPatternFor(url);
  if (!origins) return false;
  if (!chrome.permissions || !chrome.permissions.request) return false;
  try {
    return await chrome.permissions.request({ origins: [origins] });
  } catch {
    return false;
  }
}

/** Drop access again — used when a provider is switched off. */
export async function dropHostAccess(url) {
  const origins = originPatternFor(url);
  if (!origins || !chrome.permissions || !chrome.permissions.remove) return false;
  try {
    return await chrome.permissions.remove({ origins: [origins] });
  } catch {
    return false;
  }
}

/**
 * The URL an AI provider will be called on, so the UI can ask for exactly that
 * origin and no more.
 * @param {{provider: string, baseUrl?: string}} ai
 */
export function aiEndpointFor(ai = {}) {
  const bases = {
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com',
    gemini: 'https://generativelanguage.googleapis.com',
    ollama: 'http://127.0.0.1:11434',
  };
  if (ai.provider === 'openai-compatible') return ai.baseUrl || '';
  return ai.baseUrl || bases[ai.provider] || '';
}

/** The enrichment provider's endpoint. */
export function enrichmentEndpointFor(enrichment = {}) {
  return enrichment.provider === 'hunter' ? 'https://api.hunter.io' : '';
}
