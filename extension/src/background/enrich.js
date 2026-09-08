/**
 * LinkedIn Toolkit — enrichment provider interface.
 *
 * Off by default, and never a hosted service of ours: the user brings their own
 * provider and their own key. Hunter is the reference adapter; adding another
 * means adding one entry to PROVIDERS.
 *
 * Config: `enrichment: { provider: 'none' | 'hunter', apiKey? }`.
 */

import { getConfig } from '../lib/config.js';

export const HUNTER_BASE = 'https://api.hunter.io/v2/email-finder';

/**
 * Build the Hunter email-finder request.
 * @returns {{url: string}|null} null when there is not enough to ask with
 */
export function hunterRequest({ domain, firstName, lastName, fullName, apiKey }) {
  if (!domain || !apiKey) return null;

  const params = new URLSearchParams({ domain, api_key: apiKey });
  const first = firstName || String(fullName || '').split(' ')[0] || '';
  const last = lastName || String(fullName || '').split(' ').slice(1).join(' ') || '';
  if (first) params.set('first_name', first);
  if (last) params.set('last_name', last);
  if (!first && !last) return null;

  return { url: `${HUNTER_BASE}?${params.toString()}` };
}

function readHunter(json) {
  const data = (json && json.data) || {};
  const out = { provider: 'hunter' };
  if (data.email) out.email = data.email;
  if (data.phone_number) out.phone = data.phone_number;
  if (typeof data.score === 'number') out.confidence = data.score / 100;
  return out;
}

const PROVIDERS = {
  hunter: { build: hunterRequest, read: readHunter },
};

/** A domain to look a person up against, from the company or their profile. */
export function domainFor(profile = {}, company = {}) {
  const website = company.website || profile.companyWebsite || '';
  const match = String(website).match(/^(?:https?:\/\/)?(?:www\.)?([^/?#]+)/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Look up a verified email (and phone, when the provider has one).
 *
 * @param {object} profile contract Profile
 * @param {object} [company] contract Company, for its website domain
 * @returns {Promise<{email?: string, phone?: string, provider: string}>}
 *   `{ provider: 'none' }` when enrichment is off or nothing was found —
 *   enrichment never fails a pack.
 */
export async function lookupEmail(profile, company) {
  const config = await getConfig();
  const settings = config.enrichment || {};
  const adapter = PROVIDERS[settings.provider];
  if (!adapter) return { provider: 'none' };

  const request = adapter.build({
    domain: domainFor(profile, company),
    firstName: profile.firstName,
    lastName: profile.lastName,
    fullName: profile.fullName,
    apiKey: settings.apiKey,
  });
  if (!request) return { provider: settings.provider, reason: 'not-enough-input' };

  try {
    const response = await fetch(request.url, { method: 'GET' });
    if (!response.ok) return { provider: settings.provider, reason: `http-${response.status}` };
    return adapter.read(await response.json());
  } catch (e) {
    return { provider: settings.provider, reason: e.message };
  }
}

/** True when a provider other than `none` is configured with a key. */
export async function isEnrichmentConfigured() {
  const { enrichment } = await getConfig();
  return !!(enrichment && PROVIDERS[enrichment.provider] && enrichment.apiKey);
}
