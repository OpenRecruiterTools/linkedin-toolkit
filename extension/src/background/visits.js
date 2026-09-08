/**
 * LinkedIn Toolkit — metered profile reads.
 *
 * Fetching `profileView` is what LinkedIn counts as a profile visit: it shows
 * up in the other person's "who viewed your profile", and it is the single
 * thing most likely to get an account flagged when it happens hundreds of
 * times an hour. So every one of them — `profile.get`, each row of
 * `profile.export`, a connection check, a urn resolution before a message —
 * goes through the `visit` bucket and the human delay, exactly like an
 * `outreach.view` does.
 *
 * The quota is reserved before the fetch rather than recorded after it, so two
 * concurrent reads cannot both slip past the last unit of the cap.
 */

import * as quota from './quota.js';
import * as voyager from './voyager.js';

/**
 * Fetch and normalize a profile, metered as a visit.
 *
 * @param {string} publicId
 * @param {string} [source] the Profile.source to stamp
 * @returns {Promise<object>} contract Profile
 */
export async function meteredProfile(publicId, source = 'profile') {
  await quota.reserve('visit');
  await quota.humanDelay();
  return voyager.getProfileNormalized(publicId, source);
}

/** Resolve a profile urn, metered as a visit (it is a profileView underneath). */
export async function meteredProfileUrn(publicId) {
  const profile = await meteredProfile(publicId, 'urn');
  return voyager.toFsdProfileUrn(profile.urn);
}

/**
 * Connection degree for a public identifier, metered as a visit.
 * @returns {Promise<{connected: boolean, degree: number, urn: string}>}
 */
export async function meteredConnectionStatus(publicId) {
  const profile = await meteredProfile(publicId, 'connection-check');
  return {
    connected: profile.connectionDegree === 1,
    degree: profile.connectionDegree || 0,
    urn: profile.urn,
  };
}
