/**
 * LinkedIn Toolkit — extraction actions.
 *
 * Every read the contract defines: search, profiles, companies, post engagers,
 * groups, events, connections, followers and connection status. Each one
 * normalizes to a contract type and drops the result into the profile store so
 * `export.csv`, `sync.pull` and the Research Pack can read it back.
 */

import { ACTIONS, ERROR, EVENTS, EngineError } from '../lib/actions.js';
import { register } from './engine.js';
import { allActions, contactedSet, logAction, putProfile, putProfiles } from '../lib/storage.js';
import { emit } from './events.js';
import * as quota from './quota.js';
import * as voyager from './voyager.js';
import { meteredConnectionStatus, meteredProfile } from './visits.js';

/* ================================================================== */
/*  Hooks                                                             */
/* ================================================================== */

/** Installed by the content-capture module for `profile.get { full: true }`. */
let fullCapture = null;

export function setFullCapture(fn) {
  fullCapture = typeof fn === 'function' ? fn : null;
}

/* ================================================================== */
/*  Helpers                                                           */
/* ================================================================== */

export function publicIdFrom({ publicId, url }) {
  const id = publicId || voyager.publicIdFromUrl(url);
  if (!id) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Could not read a public id from that URL.');
  }
  return id;
}

export function universalNameFrom({ universalName, url }) {
  if (universalName) return universalName;
  const match = String(url || '').match(/linkedin\.com\/(?:company|school)\/([^/?#]+)/);
  if (!match) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Could not read a company name from that URL.');
  }
  return decodeURIComponent(match[1]);
}

async function store(profiles) {
  await putProfiles(profiles);
  return profiles;
}

/** Errors that mean the rest of a bulk export will fail the same way. */
const STOP_EXPORT = new Set([
  ERROR.QUOTA_EXCEEDED,
  ERROR.OUTSIDE_BUSINESS_HOURS,
  ERROR.RATE_LIMITED,
  ERROR.CHALLENGE_DETECTED,
  ERROR.NOT_LOGGED_IN,
]);

/**
 * Every audience read returns people, and LinkedIn meters people by the
 * result. Charge them to the search bucket the same way `search.people` is.
 */
async function meteredAudience(count, run) {
  await quota.check('search', count);
  const out = await run();
  const profiles = out.profiles || out.engagers || [];
  await quota.record('search', profiles.length);
  return out;
}

/* ================================================================== */
/*  Search                                                            */
/* ================================================================== */

register(ACTIONS.SEARCH_PEOPLE, async (params) => {
  const count = params.count || 25;
  await quota.check('search', count);

  const out = await voyager.searchProfiles({ ...params, count });
  await quota.record('search', out.profiles.length);
  await store(out.profiles);

  return { profiles: out.profiles, total: out.total, nextStart: out.nextStart };
});

/* ================================================================== */
/*  Profiles                                                          */
/* ================================================================== */

/**
 * One profile, metered as a visit — because that is exactly what LinkedIn
 * records when we fetch a profileView.
 */
async function fetchProfile(publicId, full) {
  const profile = await meteredProfile(publicId);
  if (full && fullCapture) {
    const extra = await fullCapture(profile);
    if (extra) Object.assign(profile, extra);
  }
  await putProfile(profile);
  return profile;
}

register(ACTIONS.PROFILE_GET, async (params) => fetchProfile(publicIdFrom(params), params.full));

register(ACTIONS.PROFILE_EXPORT, async ({ urls, full }) => {
  const profiles = [];
  const failed = [];
  for (const url of urls) {
    let publicId;
    try {
      publicId = publicIdFrom({ url });
    } catch {
      failed.push({ url, error: 'Not a LinkedIn profile URL' });
      continue;
    }
    try {
      // fetchProfile reserves a visit and paces itself, so a long export runs
      // at human speed and stops cleanly when the daily cap is reached.
      profiles.push(await fetchProfile(publicId, full));
    } catch (e) {
      failed.push({ url, error: e.message });
      if (STOP_EXPORT.has(e.code)) break;
    }
  }
  return { profiles, failed };
});

/* ================================================================== */
/*  Companies                                                         */
/* ================================================================== */

register(ACTIONS.COMPANY_GET, async (params) => voyager.getCompany(universalNameFrom(params)));

register(ACTIONS.COMPANY_EMPLOYEES, async ({ universalName, start = 0, count = 25 }) => {
  await quota.check('search', count);
  const out = await voyager.getCompanyEmployees({ universalName, start, count });
  await quota.record('search', out.profiles.length);
  await store(out.profiles);
  return { profiles: out.profiles, nextStart: out.nextStart };
});

/* ================================================================== */
/*  Audiences                                                         */
/* ================================================================== */

register(ACTIONS.POST_ENGAGERS, async ({ postUrl, kind = 'both', start = 0, count = 25 }) => {
  const out = await meteredAudience(count, () =>
    voyager.getPostEngagers({ postUrl, kind, start, count }),
  );
  await store(out.engagers.map((e) => ({ ...e, engagedWithPost: true })));
  return { engagers: out.engagers, nextStart: out.nextStart };
});

register(ACTIONS.GROUP_MEMBERS, async ({ groupUrl, start = 0, count = 25 }) => {
  const out = await meteredAudience(count, () =>
    voyager.getGroupMembers({ groupUrl, start, count }),
  );
  await store(out.profiles);
  return { profiles: out.profiles, nextStart: out.nextStart };
});

register(ACTIONS.EVENT_ATTENDEES, async ({ eventUrl, start = 0, count = 25 }) => {
  const out = await meteredAudience(count, () =>
    voyager.getEventAttendees({ eventUrl, start, count }),
  );
  await store(out.profiles);
  return { profiles: out.profiles, nextStart: out.nextStart };
});

register(ACTIONS.NETWORK_CONNECTIONS, async ({ start = 0, count = 25 } = {}) => {
  const out = await meteredAudience(count, () => voyager.getConnections({ start, count }));
  await store(out.profiles);
  return { profiles: out.profiles, nextStart: out.nextStart };
});

register(ACTIONS.NETWORK_FOLLOWERS, async ({ start = 0, count = 25 } = {}) => {
  const out = await meteredAudience(count, () => voyager.getFollowers({ start, count }));
  await store(out.profiles);
  return { profiles: out.profiles, nextStart: out.nextStart };
});

/* ================================================================== */
/*  Connection status                                                 */
/* ================================================================== */

/** No client may ask about more people than this in one call. */
export const MAX_STATUS_IDS = 25;

/**
 * Connection status for a handful of people, spending as few profile views as
 * possible.
 *
 * One call to the sent-invitations collection answers "still pending?" for
 * everybody at once. For anyone we invited who is no longer pending, the
 * invitation landed — that is the accepted case, and it needs no profile view
 * at all. Only someone we have never invited forces a profileView, and that
 * one is metered as the visit it is.
 *
 * (An invitation can also leave the pending list by being withdrawn or by
 * expiring after a year. Both are rare next to acceptance, and both resolve
 * themselves the next time we actually look at the profile.)
 */
register(ACTIONS.NETWORK_STATUS, async ({ publicIds }) => {
  if (publicIds.length > MAX_STATUS_IDS) {
    throw new EngineError(
      ERROR.INVALID_PARAMS,
      `network.status takes at most ${MAX_STATUS_IDS} publicIds at a time (asked for ${publicIds.length}).`,
      { howToFix: `Send them in batches of ${MAX_STATUS_IDS}.` },
    );
  }

  const invited = await contactedSet();
  const alreadyAccepted = new Set(
    (await allActions()).filter((e) => e.action === EVENTS.INVITE_ACCEPTED).map((e) => e.publicId),
  );

  let pending = new Set();
  try {
    pending = new Set((await voyager.getSentInvitations()).map((i) => i.publicId));
  } catch {
    // No invitations collection: fall back to profile reads below.
  }

  const statuses = {};

  for (const publicId of publicIds) {
    if (pending.has(publicId)) {
      statuses[publicId] = 'pending';
      continue;
    }

    if (invited.has(publicId)) {
      statuses[publicId] = 'connected';
      if (!alreadyAccepted.has(publicId)) {
        alreadyAccepted.add(publicId);
        await logAction({ action: EVENTS.INVITE_ACCEPTED, publicId, origin: 'system' });
        await emit(EVENTS.INVITE_ACCEPTED, { publicId });
      }
      continue;
    }

    try {
      const { connected } = await meteredConnectionStatus(publicId);
      statuses[publicId] = connected ? 'connected' : 'none';
    } catch (e) {
      if (STOP_EXPORT.has(e.code)) throw e;
      statuses[publicId] = 'none';
    }
  }

  return { statuses };
});

/* ================================================================== */
/*  Unfollow helpers stay in index.js (they drive the user's own tab)  */
/* ================================================================== */
