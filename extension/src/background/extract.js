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
import { allActions, logAction, putProfile, putProfiles } from '../lib/storage.js';
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
 * Everyone we have actually sent an invitation to, and when the latest one
 * went out. Only `outreach.invite` counts — a message or a comment is contact,
 * not an invitation, and must never make somebody look "pending".
 */
async function invitedAt() {
  const log = await allActions();
  const out = new Map();
  for (const entry of log) {
    if (entry.action !== ACTIONS.OUTREACH_INVITE) continue;
    if (entry.result && entry.result.status && entry.result.status !== 'sent') continue;
    if (!entry.publicId) continue;
    out.set(entry.publicId, Math.max(out.get(entry.publicId) || 0, entry.at || 0));
  }
  return out;
}

/**
 * Connection status for a handful of people, spending as few profile views as
 * possible — and never guessing.
 *
 * One call to the sent-invitations collection answers "still pending?" for
 * everybody at once, which is the case that matters during a campaign and
 * costs nothing. An invitation that has *left* that list has either been
 * accepted, withdrawn or expired, and only a profile read can tell those
 * apart, so that is what happens — once, cached for the day.
 *
 * `invite_accepted` is only ever emitted on a positive signal: the invitation
 * is gone *and* the profile reads as a first-degree connection. When the
 * invitations collection is unavailable (LinkedIn moved the endpoint, we are
 * backed off, the quota is gone) an invited person is reported `pending`,
 * because an unconfirmed guess of `connected` would stop a campaign dead and
 * fire a false acceptance for everybody we have ever invited.
 *
 * Running out of quota part way through is not a failure of the whole call:
 * what was resolved is returned, the rest is reported conservatively, and
 * `partial: true` says so. It throws only when it would otherwise have to
 * invent an answer — a stranger, with nothing resolved yet.
 */
register(ACTIONS.NETWORK_STATUS, async ({ publicIds }) => {
  if (publicIds.length > MAX_STATUS_IDS) {
    throw new EngineError(
      ERROR.INVALID_PARAMS,
      `network.status takes at most ${MAX_STATUS_IDS} publicIds at a time (asked for ${publicIds.length}).`,
      { howToFix: `Send them in batches of ${MAX_STATUS_IDS}.` },
    );
  }

  const invited = await invitedAt();
  const announced = new Set(
    (await allActions()).filter((e) => e.action === EVENTS.INVITE_ACCEPTED).map((e) => e.publicId),
  );

  let pending = new Set();
  let invitationsOk = true;
  try {
    pending = new Set((await voyager.getSentInvitations()).map((i) => i.publicId));
  } catch {
    // The endpoint is gone, or we are backed off. Fall back to profile reads
    // for anyone we invited, and never conclude anything from its silence.
    invitationsOk = false;
  }

  const statuses = {};
  /** Set once a read has been refused; we stop trying rather than re-reserving. */
  let readsBlocked = null;

  /** What to say about somebody we could not look at. */
  const unresolved = (publicId) => (invited.has(publicId) ? 'pending' : 'none');

  for (const publicId of publicIds) {
    if (invitationsOk && pending.has(publicId)) {
      statuses[publicId] = 'pending';
      continue;
    }

    const wasInvited = invited.has(publicId);

    if (readsBlocked) {
      statuses[publicId] = unresolved(publicId);
      continue;
    }

    let degree = null;
    try {
      // A read taken before the invitation went out cannot confirm it landed,
      // and for an invited person only a positive cached answer counts.
      degree = (
        await meteredConnectionStatus(publicId, {
          after: invited.get(publicId) || 0,
          positiveOnly: wasInvited,
        })
      ).degree;
    } catch (e) {
      if (STOP_EXPORT.has(e.code)) {
        // We throw only when we would otherwise be inventing an answer: for
        // somebody we invited, 'pending' is honest without any read, so the
        // batch degrades instead. For a stranger with nothing resolved yet
        // there is no honest answer, so say why.
        if (!Object.keys(statuses).length && !wasInvited) throw e;
        readsBlocked = e;
        statuses[publicId] = unresolved(publicId);
        continue;
      }
      statuses[publicId] = unresolved(publicId);
      continue;
    }

    if (degree === 1) {
      statuses[publicId] = 'connected';
      if (wasInvited && !announced.has(publicId)) {
        announced.add(publicId);
        await logAction({ action: EVENTS.INVITE_ACCEPTED, publicId, origin: 'system' });
        await emit(EVENTS.INVITE_ACCEPTED, { publicId });
      }
      continue;
    }

    // Invited but not connected: the invitation is outstanding, or it was
    // withdrawn or expired. Either way it is not an acceptance.
    statuses[publicId] = wasInvited ? 'pending' : 'none';
  }

  return readsBlocked
    ? { statuses, partial: true, reason: readsBlocked.code }
    : { statuses };
});

/* ================================================================== */
/*  Unfollow helpers stay in index.js (they drive the user's own tab)  */
/* ================================================================== */
