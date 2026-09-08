/**
 * LinkedIn Toolkit — lists.
 *
 * A list is a named, deduplicated bag of people plus tags. Members are stored
 * under `listMembers:{listId}`; `contactedBefore` and `signals` are *derived*
 * at read time from the action log and the stored profile, so they never go
 * stale.
 */

import { ACTIONS, ERROR, EngineError } from '../lib/actions.js';
import { fromCsv } from '../lib/csv.js';
import { K, contactedSet, get, getStoredProfile, newId, remove, set, stamp } from '../lib/storage.js';
import { publicIdFromUrl, toProfile } from './voyager-normalize.js';
import { register } from './engine.js';

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

/* ================================================================== */
/*  Storage                                                           */
/* ================================================================== */

async function readLists() {
  return get(K.LISTS, []);
}

async function writeLists(lists) {
  await set(K.LISTS, lists);
  return lists;
}

async function readMembers(listId) {
  return get(K.listMembers(listId), []);
}

async function writeMembers(listId, members) {
  await set(K.listMembers(listId), members);
  const lists = await readLists();
  const list = lists.find((l) => l.listId === listId);
  if (list) {
    list.count = members.length;
    list.updatedAt = Date.now();
    await writeLists(lists);
  }
  return members;
}

async function requireList(listId) {
  const list = (await readLists()).find((l) => l.listId === listId);
  if (!list) throw new EngineError(ERROR.NOT_FOUND, `List ${listId} not found.`);
  return list;
}

/* ================================================================== */
/*  Signals                                                           */
/* ================================================================== */

/**
 * Facts about a person that are worth acting on.
 *  - `changedJobRecently` — their current role started under 90 days ago
 *  - `atTargetCompany`    — a `company:<name>` tag on the list matches
 *  - `engagedWithPost`    — flagged by a `post.engagers` import
 *
 * @param {object} profile
 * @param {string[]} tags the list's tags
 * @returns {string[]}
 */
export function computeSignals(profile = {}, tags = []) {
  const signals = [];

  const current = (profile.experience || []).filter((e) => !e.end);
  const latest = current.sort((a, b) => (b.start || 0) - (a.start || 0))[0];
  if (latest && latest.start && Date.now() - latest.start < NINETY_DAYS) {
    signals.push('changedJobRecently');
  }

  const company = String(profile.company || '').trim().toLowerCase();
  if (company) {
    const targets = (tags || [])
      .filter((t) => String(t).toLowerCase().startsWith('company:'))
      .map((t) => String(t).slice('company:'.length).trim().toLowerCase());
    if (targets.includes(company)) signals.push('atTargetCompany');
  }

  if (profile.engagedWithPost) signals.push('engagedWithPost');

  return signals;
}

/** Attach the derived fields to the stored member records. */
async function decorate(list, members) {
  const contacted = await contactedSet();
  return members.map((m) => ({
    ...m,
    contactedBefore: contacted.has(m.publicId),
    signals: computeSignals(m.profile, list.tags),
  }));
}

/* ================================================================== */
/*  Public interface                                                  */
/* ================================================================== */

export async function create(name, tags = []) {
  const lists = await readLists();
  const list = stamp({
    listId: newId('list'),
    name,
    tags: tags || [],
    createdAt: Date.now(),
    count: 0,
  });
  lists.push(list);
  await writeLists(lists);
  return list;
}

export async function getAll() {
  return readLists();
}

export async function getOne(listId) {
  return requireList(listId);
}

/** Find a list by name, creating it if it is not there yet. */
export async function ensureList(name, tags = []) {
  const existing = (await readLists()).find((l) => l.name === name);
  return existing || create(name, tags);
}

/**
 * Add people. Accepts `profiles` (contract Profiles) and/or bare `publicIds`,
 * which are back-filled from the profile store.
 * @returns {Promise<{added: number, duplicates: number}>}
 */
export async function add(listId, { profiles = [], publicIds = [] } = {}) {
  await requireList(listId);
  const members = await readMembers(listId);
  const seen = new Set(members.map((m) => m.publicId));

  const incoming = [...profiles];
  for (const publicId of publicIds) {
    const stored = await getStoredProfile(publicId);
    incoming.push(stored || toProfile({ publicId }, 'manual'));
  }

  let added = 0;
  let duplicates = 0;

  for (const profile of incoming) {
    const publicId = profile && (profile.publicId || publicIdFromUrl(profile.url));
    if (!publicId) {
      duplicates += 0;
      continue;
    }
    if (seen.has(publicId)) {
      duplicates += 1;
      continue;
    }
    seen.add(publicId);
    members.push(
      stamp({
        publicId,
        profile: { ...profile, publicId },
        addedAt: Date.now(),
        tags: [],
      }),
    );
    added += 1;
  }

  await writeMembers(listId, members);
  return { added, duplicates };
}

export async function removeMembers(listId, publicIds) {
  await requireList(listId);
  const members = await readMembers(listId);
  const drop = new Set(publicIds);
  const kept = members.filter((m) => !drop.has(m.publicId));
  await writeMembers(listId, kept);
  return { removed: members.length - kept.length };
}

export async function members(listId, { start = 0, count = 100 } = {}) {
  const list = await requireList(listId);
  const all = await readMembers(listId);
  const page = await decorate(list, all.slice(start, start + count));
  return { members: page, total: all.length };
}

/** Every member of a list, decorated — used by campaigns, export and research. */
export async function allMembers(listId) {
  const list = await requireList(listId);
  return decorate(list, await readMembers(listId));
}

export async function del(listId) {
  await requireList(listId);
  const lists = await readLists();
  await writeLists(lists.filter((l) => l.listId !== listId));
  await remove(K.listMembers(listId));
  return { ok: true };
}

/* ================================================================== */
/*  CSV import                                                        */
/* ================================================================== */

const COLUMN_ALIASES = {
  url: ['url', 'linkedin_url', 'linkedinurl', 'profile', 'profile_url', 'linkedin'],
  firstName: ['first_name', 'firstname', 'first'],
  lastName: ['last_name', 'lastname', 'last'],
  company: ['company', 'company_name', 'organisation', 'organization'],
  title: ['title', 'job_title', 'position', 'role'],
};

function columnMap(headers) {
  const map = {};
  const normalized = headers.map((h) => String(h).trim().toLowerCase());
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = normalized.findIndex((h) => aliases.includes(h));
    if (index >= 0) map[field] = headers[index];
  }
  return map;
}

/**
 * Import rows into a list. Columns are matched case-insensitively against
 * `url|linkedin_url|profile`, `first_name`, `last_name`, `company`, `title`.
 * A row with no readable LinkedIn profile URL is counted as invalid.
 */
export async function importCsv(listId, csv) {
  await requireList(listId);
  const { headers, rows } = fromCsv(csv);
  const map = columnMap(headers);

  const profiles = [];
  let invalid = 0;

  for (const row of rows) {
    const url = map.url ? row[map.url] : '';
    const publicId = publicIdFromUrl(url);
    if (!publicId) {
      invalid += 1;
      continue;
    }
    const firstName = map.firstName ? row[map.firstName] : '';
    const lastName = map.lastName ? row[map.lastName] : '';
    profiles.push(
      toProfile(
        {
          publicId,
          url,
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`.trim(),
          company: map.company ? row[map.company] : '',
          title: map.title ? row[map.title] : '',
        },
        'csv',
      ),
    );
  }

  const { added, duplicates } = await add(listId, { profiles });
  return { added, duplicates, invalid };
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

register(ACTIONS.LIST_CREATE, ({ name, tags }) => create(name, tags));
register(ACTIONS.LIST_GET_ALL, async () => ({ lists: await getAll() }));
register(ACTIONS.LIST_GET, ({ listId }) => getOne(listId));
register(ACTIONS.LIST_ADD, ({ listId, profiles, publicIds }) =>
  add(listId, { profiles, publicIds }),
);
register(ACTIONS.LIST_REMOVE, ({ listId, publicIds }) => removeMembers(listId, publicIds));
register(ACTIONS.LIST_MEMBERS, ({ listId, start, count }) => members(listId, { start, count }));
register(ACTIONS.LIST_DELETE, ({ listId }) => del(listId));
register(ACTIONS.LIST_IMPORT_CSV, ({ listId, csv }) => importCsv(listId, csv));
