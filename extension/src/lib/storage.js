/**
 * LinkedIn Toolkit — storage helpers.
 *
 * Everything the engine persists goes through this module: a thin promise
 * wrapper over `chrome.storage.local`, the profile store, and the `actions`
 * log that feeds `contactedBefore`, campaign stats and `sync.pull`.
 *
 * Every record carries `updatedAt` so `sync.pull { since }` can answer with
 * only what changed.
 */

/* ================================================================== */
/*  Storage keys                                                      */
/* ================================================================== */

export const K = Object.freeze({
  CONFIG: 'config',
  QUOTA: 'quota',

  LISTS: 'lists',
  listMembers: (listId) => `listMembers:${listId}`,

  QUEUE: 'queue',

  CAMPAIGNS: 'campaigns',
  enrollments: (campaignId) => `enrollments:${campaignId}`,

  ACTIONS: 'actions',

  PROFILE_INDEX: 'profileIndex',
  profile: (publicId) => `profile:${publicId}`,

  THREADS: 'threads',
  messages: (threadId) => `messages:${threadId}`,
  INBOX_SEEN: 'inboxSeen',

  EVENTS: 'events',

  RESEARCH_JOBS: 'researchJobs',
  researchPacks: (jobId) => `researchPacks:${jobId}`,

  BRIDGE: 'bridgeState',
});

/** Page text is captured verbatim; cap it so the profile store stays sane. */
export const MAX_PAGE_TEXT = 60000;

/** Keep the action log bounded — it is a rolling audit trail, not an archive. */
export const MAX_ACTION_LOG = 5000;

/* ================================================================== */
/*  Primitives                                                        */
/* ================================================================== */

export async function get(key, fallback = null) {
  const data = await chrome.storage.local.get(key);
  const value = data ? data[key] : undefined;
  return value === undefined ? fallback : value;
}

export async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
  return value;
}

export async function remove(key) {
  await chrome.storage.local.remove(key);
}

export async function getMany(keys) {
  return chrome.storage.local.get(keys);
}

/** Read-modify-write a single key. */
export async function update(key, fn, fallback = null) {
  const current = await get(key, fallback);
  const next = await fn(current);
  await set(key, next);
  return next;
}

/* ================================================================== */
/*  Ids and timestamps                                                */
/* ================================================================== */

let seq = 0;

export function newId(prefix = 'id') {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Copy of `record` carrying a fresh `updatedAt`. Never mutates the input. */
export function stamp(record, at = Date.now()) {
  return { ...(record || {}), updatedAt: at };
}

/** Filter any array of stamped records by `updatedAt`. */
export function since(records, from = 0) {
  const cutoff = Number(from) || 0;
  return (records || []).filter((r) => (r.updatedAt || 0) > cutoff);
}

/* ================================================================== */
/*  Profile store                                                     */
/* ================================================================== */

function trimProfile(profile) {
  const out = { ...profile };
  if (typeof out.pageText === 'string' && out.pageText.length > MAX_PAGE_TEXT) {
    out.pageText = out.pageText.slice(0, MAX_PAGE_TEXT);
  }
  return out;
}

/**
 * Upsert a Profile. Existing fields survive a partial write, so a cheap search
 * hit never erases a full capture.
 */
export async function putProfile(profile) {
  const publicId = profile && profile.publicId;
  if (!publicId) return null;

  const key = K.profile(publicId);
  const existing = await get(key, null);
  const merged = stamp(
    trimProfile({ ...(existing || {}), ...profile, publicId }),
    profile.updatedAt || Date.now(),
  );
  await set(key, merged);

  const index = await get(K.PROFILE_INDEX, []);
  if (!index.includes(publicId)) {
    index.push(publicId);
    await set(K.PROFILE_INDEX, index);
  }
  return merged;
}

export async function putProfiles(profiles) {
  const out = [];
  for (const p of profiles || []) {
    const rec = await putProfile(p);
    if (rec) out.push(rec);
  }
  return out;
}

export async function getStoredProfile(publicId) {
  if (!publicId) return null;
  return get(K.profile(publicId), null);
}

export async function allProfiles() {
  const index = await get(K.PROFILE_INDEX, []);
  if (!index.length) return [];
  const data = await getMany(index.map(K.profile));
  return index.map((id) => data[K.profile(id)]).filter(Boolean);
}

export async function profilesSince(from = 0) {
  return since(await allProfiles(), from);
}

/* ================================================================== */
/*  Action log                                                        */
/* ================================================================== */

/** Actions that count as having reached out to somebody. */
const CONTACT_ACTIONS = new Set([
  'outreach.invite',
  'outreach.message',
  'outreach.inmail',
  'outreach.comment',
]);

/**
 * Append one entry to the `actions` log.
 * @param {{action: string, publicId?: string, origin?: string, result?: object, at?: number, campaignId?: string, stepIndex?: number}} entry
 */
export async function logAction(entry) {
  const record = {
    id: newId('act'),
    action: entry.action,
    publicId: entry.publicId || '',
    at: entry.at || Date.now(),
    origin: entry.origin || 'popup',
    result: entry.result || null,
  };
  if (entry.campaignId) record.campaignId = entry.campaignId;
  if (entry.stepIndex !== undefined) record.stepIndex = entry.stepIndex;
  record.updatedAt = record.at;

  const log = await get(K.ACTIONS, []);
  log.push(record);
  await set(K.ACTIONS, log.length > MAX_ACTION_LOG ? log.slice(-MAX_ACTION_LOG) : log);
  return record;
}

export async function allActions() {
  return get(K.ACTIONS, []);
}

export async function actionsSince(from = 0) {
  const cutoff = Number(from) || 0;
  return (await allActions()).filter((e) => (e.at || 0) > cutoff);
}

export async function actionsFor(publicId) {
  return (await allActions()).filter((e) => e.publicId === publicId);
}

/** True when we have already invited, messaged, InMailed or commented at them. */
export async function contactedBefore(publicId) {
  if (!publicId) return false;
  return (await allActions()).some(
    (e) => e.publicId === publicId && CONTACT_ACTIONS.has(e.action),
  );
}

/** Batch form of `contactedBefore` — one storage read for a whole list. */
export async function contactedSet() {
  const log = await allActions();
  const out = new Set();
  for (const e of log) if (CONTACT_ACTIONS.has(e.action) && e.publicId) out.add(e.publicId);
  return out;
}
