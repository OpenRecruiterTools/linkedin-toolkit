/**
 * LinkedIn Toolkit — metered profile reads.
 *
 * Fetching `profileView` is what LinkedIn counts as a profile visit: it shows
 * up in the other person's "who viewed your profile", and it is the single
 * thing most likely to get an account flagged when it happens hundreds of
 * times an hour. So every one of them goes through the `visit` bucket and the
 * human delay, exactly like an `outreach.view` does.
 *
 * One fetch answers several questions at once — the degree, the urn, the
 * current employer — so a read is cached in the profile store and reused for
 * the rest of the day. A campaign invite to a stranger checks whether they are
 * already connected and then resolves their urn; that is one profile view, not
 * two.
 *
 * The quota is reserved before the fetch rather than recorded after it, so two
 * concurrent reads cannot both slip past the last unit of the cap.
 */

import { getStoredProfile, putProfile } from '../lib/storage.js';
import * as quota from './quota.js';
import * as voyager from './voyager.js';

/** How long a profile read stays good enough to answer degree and urn. */
export const PROFILE_CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * Fetch and normalize a profile, metered as a visit, and remember it.
 *
 * `profileViewedAt` marks the record as having come from a real profile view,
 * which a search hit or a CSV import never has — so the cache can tell the
 * difference between "we looked at this person" and "we know their name".
 *
 * @param {string} publicId
 * @param {string} [source] the Profile.source to stamp
 * @returns {Promise<object>} contract Profile
 */
export async function meteredProfile(publicId, source = 'profile') {
  await quota.reserve('visit');
  await quota.humanDelay();

  const profile = await voyager.getProfileNormalized(publicId, source);
  profile.profileViewedAt = Date.now();
  await putProfile(profile);
  return profile;
}

/**
 * True when a stored record came from a profile view inside the window, and
 * after whatever event the caller is asking about.
 *
 * `after` matters for an acceptance check: a profile read taken *before* we
 * sent the invitation says nothing about whether it was accepted, however
 * recent it is.
 */
export function isFresh(record, maxAgeMs = PROFILE_CACHE_MS, after = 0) {
  if (!record || !record.profileViewedAt) return false;
  if (Date.now() - record.profileViewedAt >= maxAgeMs) return false;
  return record.profileViewedAt > after;
}

/**
 * A profile good enough to read a degree or a urn off, fetching one only when
 * what we already have is stale.
 *
 * @param {string} publicId
 * @param {{maxAgeMs?: number, source?: string}} [options]
 */
export async function cachedProfile(publicId, { maxAgeMs = PROFILE_CACHE_MS, after = 0, source } = {}) {
  const stored = await getStoredProfile(publicId);
  if (isFresh(stored, maxAgeMs, after)) return stored;
  return meteredProfile(publicId, source);
}

/** Resolve a profile urn, reusing today's read rather than making another. */
export async function meteredProfileUrn(publicId) {
  const profile = await cachedProfile(publicId, { source: 'urn' });
  return voyager.toFsdProfileUrn(profile.urn);
}

/**
 * Connection degree for a public identifier, reusing today's read.
 * @returns {Promise<{connected: boolean, degree: number, urn: string, cached: boolean}>}
 */
export async function meteredConnectionStatus(
  publicId,
  { maxAgeMs = PROFILE_CACHE_MS, after = 0 } = {},
) {
  const stored = await getStoredProfile(publicId);
  const cached = isFresh(stored, maxAgeMs, after);
  const profile = cached ? stored : await meteredProfile(publicId, 'connection-check');
  return {
    connected: profile.connectionDegree === 1,
    degree: profile.connectionDegree || 0,
    urn: profile.urn,
    cached,
  };
}
