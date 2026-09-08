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

async function fetchProfile(publicId, full) {
  const profile = await voyager.getProfileNormalized(publicId);
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
      profiles.push(await fetchProfile(publicId, full));
    } catch (e) {
      failed.push({ url, error: e.message });
    }
    if (urls.length > 1) await quota.humanDelay();
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
  const out = await voyager.getPostEngagers({ postUrl, kind, start, count });
  await store(out.engagers.map((e) => ({ ...e, engagedWithPost: true })));
  return { engagers: out.engagers, nextStart: out.nextStart };
});

register(ACTIONS.GROUP_MEMBERS, async ({ groupUrl, start = 0, count = 25 }) => {
  const out = await voyager.getGroupMembers({ groupUrl, start, count });
  await store(out.profiles);
  return { profiles: out.profiles, nextStart: out.nextStart };
});

register(ACTIONS.EVENT_ATTENDEES, async ({ eventUrl, start = 0, count = 25 }) => {
  const out = await voyager.getEventAttendees({ eventUrl, start, count });
  await store(out.profiles);
  return { profiles: out.profiles, nextStart: out.nextStart };
});

register(ACTIONS.NETWORK_CONNECTIONS, async ({ start = 0, count = 25 } = {}) => {
  const out = await voyager.getConnections({ start, count });
  await store(out.profiles);
  return { profiles: out.profiles, nextStart: out.nextStart };
});

register(ACTIONS.NETWORK_FOLLOWERS, async ({ start = 0, count = 25 } = {}) => {
  const out = await voyager.getFollowers({ start, count });
  await store(out.profiles);
  return { profiles: out.profiles, nextStart: out.nextStart };
});

/* ================================================================== */
/*  Connection status                                                 */
/* ================================================================== */

/**
 * `connected` when we are 1st degree, `pending` when we have invited them and
 * are not, `none` otherwise. Crossing from pending to connected emits
 * `invite_accepted` — this is how campaigns learn an invite landed.
 */
register(ACTIONS.NETWORK_STATUS, async ({ publicIds }) => {
  const invited = await contactedSet();
  const alreadyAccepted = new Set(
    (await allActions())
      .filter((e) => e.action === EVENTS.INVITE_ACCEPTED)
      .map((e) => e.publicId),
  );
  const statuses = {};

  for (const publicId of publicIds) {
    let degree = 0;
    try {
      degree = (await voyager.getConnectionStatus(publicId)).degree;
    } catch {
      statuses[publicId] = 'none';
      continue;
    }

    if (degree === 1) {
      statuses[publicId] = 'connected';
      if (invited.has(publicId) && !alreadyAccepted.has(publicId)) {
        await logAction({ action: EVENTS.INVITE_ACCEPTED, publicId, origin: 'system' });
        await emit(EVENTS.INVITE_ACCEPTED, { publicId });
      }
    } else if (invited.has(publicId)) {
      statuses[publicId] = 'pending';
    } else {
      statuses[publicId] = 'none';
    }
  }

  return { statuses };
});

/* ================================================================== */
/*  Unfollow helpers stay in index.js (they drive the user's own tab)  */
/* ================================================================== */
