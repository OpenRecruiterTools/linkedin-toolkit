/**
 * LinkedIn Toolkit — export.csv and sync.pull.
 *
 * `export.csv` builds a CSV from the engine's own stores. `sync.pull` hands a
 * client everything that changed since a timestamp, which is how the MCP
 * server keeps its SQLite mirror up to date without ever polling LinkedIn.
 */

import { ACTIONS, ERROR, EngineError } from '../lib/actions.js';
import { toCsv } from '../lib/csv.js';
import {
  K,
  allActions,
  allProfiles,
  actionsSince,
  get,
  profilesSince,
  since as sinceFilter,
} from '../lib/storage.js';
import { register } from './engine.js';
import { readCampaigns, readEnrollments } from './campaigns.js';
import { recent as recentEvents } from './events.js';
import * as inbox from './inbox.js';
import * as lists from './lists.js';

/* ================================================================== */
/*  Column sets                                                       */
/* ================================================================== */

const PROFILE_COLUMNS = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'headline', label: 'Headline' },
  { key: 'title', label: 'Title' },
  { key: 'company', label: 'Company' },
  { key: 'location', label: 'Location' },
  { key: 'industry', label: 'Industry' },
  { key: 'url', label: 'LinkedIn URL' },
  { key: 'connectionDegree', label: 'Degree' },
  { key: 'summary', label: 'Summary' },
  { key: 'skills', label: 'Skills' },
];

const MEMBER_COLUMNS = [
  ...PROFILE_COLUMNS,
  { key: 'contactedBefore', label: 'Contacted Before' },
  { key: 'signals', label: 'Signals' },
  { key: 'addedAt', label: 'Added At' },
];

const ENROLLMENT_COLUMNS = [
  { key: 'publicId', label: 'Public Id' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'company', label: 'Company' },
  { key: 'status', label: 'Status' },
  { key: 'stepIndex', label: 'Step' },
  { key: 'path', label: 'Branch Path' },
  { key: 'lastActionAt', label: 'Last Action At' },
  { key: 'nextAt', label: 'Next At' },
  { key: 'sent', label: 'Actions Sent' },
];

const THREAD_COLUMNS = [
  { key: 'threadId', label: 'Thread Id' },
  { key: 'participants', label: 'Participants' },
  { key: 'lastMessageAt', label: 'Last Message At' },
  { key: 'unread', label: 'Unread' },
  { key: 'sentiment', label: 'Sentiment' },
  { key: 'snippet', label: 'Snippet' },
];

const iso = (ms) => (ms ? new Date(ms).toISOString() : '');

/* ================================================================== */
/*  Row builders                                                      */
/* ================================================================== */

async function profileRows(override) {
  const profiles = override && override.length ? override : await allProfiles();
  // An ad-hoc set handed in by the popup may still carry the v1 `linkedinUrl`.
  const rows = profiles.map((p) => (p.url ? p : { ...p, url: p.linkedinUrl || '' }));
  return { rows, columns: PROFILE_COLUMNS };
}

async function listRows(listId) {
  if (!listId) throw new EngineError(ERROR.INVALID_PARAMS, "export.csv kind 'list' needs an id.");
  const members = await lists.allMembers(listId);
  const rows = members.map((m) => ({
    ...m.profile,
    contactedBefore: m.contactedBefore ? 'yes' : 'no',
    signals: m.signals || [],
    addedAt: iso(m.addedAt),
  }));
  return { rows, columns: MEMBER_COLUMNS };
}

async function campaignRows(campaignId) {
  if (!campaignId) {
    throw new EngineError(ERROR.INVALID_PARAMS, "export.csv kind 'campaign' needs an id.");
  }
  const campaign = (await readCampaigns()).find((c) => c.campaignId === campaignId);
  if (!campaign) throw new EngineError(ERROR.NOT_FOUND, `Campaign ${campaignId} not found.`);

  const enrollments = await readEnrollments(campaignId);
  const log = (await allActions()).filter((e) => e.campaignId === campaignId);
  const profiles = new Map((await allProfiles()).map((p) => [p.publicId, p]));

  const rows = enrollments.map((e) => {
    const profile = profiles.get(e.publicId) || {};
    return {
      publicId: e.publicId,
      fullName: profile.fullName || '',
      company: profile.company || '',
      status: e.status,
      stepIndex: e.stepIndex,
      path: (e.path || []).join('>'),
      lastActionAt: iso(e.lastActionAt),
      nextAt: iso(e.nextAt),
      sent: log.filter(
        (a) => a.publicId === e.publicId && a.result && a.result.status === 'sent',
      ).length,
    };
  });
  return { rows, columns: ENROLLMENT_COLUMNS };
}

async function inboxRows() {
  const threads = await inbox.storedThreads();
  const rows = threads.map((t) => ({
    ...t,
    participants: (t.participants || []).map((p) => p.fullName || p.publicId),
    lastMessageAt: iso(t.lastMessageAt),
    unread: t.unread ? 'yes' : 'no',
  }));
  return { rows, columns: THREAD_COLUMNS };
}

/* ================================================================== */
/*  export.csv                                                        */
/* ================================================================== */

const BUILDERS = {
  profiles: (params) => profileRows(params.profiles),
  list: (params) => listRows(params.id),
  campaign: (params) => campaignRows(params.id),
  inbox: () => inboxRows(),
};

function filenameFor(kind) {
  const date = new Date().toISOString().slice(0, 10);
  return kind === 'profiles' ? `linkedin_export_${date}.csv` : `linkedin_${kind}_${date}.csv`;
}

/**
 * Build a CSV from the engine's stores.
 *
 * @param {{kind: 'profiles'|'list'|'campaign'|'inbox', id?: string, profiles?: object[], download?: boolean}} params
 * @returns {Promise<{csv: string, filename: string, count: number, downloaded?: boolean}>}
 */
export async function exportCsv(params = {}) {
  const build = BUILDERS[params.kind];
  if (!build) throw new EngineError(ERROR.INVALID_PARAMS, `Unknown export kind: ${params.kind}`);

  const { rows, columns } = await build(params);
  if (!rows.length) {
    throw new EngineError(ERROR.NOT_FOUND, `No data to export for kind '${params.kind}'.`);
  }

  const csv = toCsv(rows, columns);
  const filename = filenameFor(params.kind);
  const out = { csv, filename, count: rows.length };

  if (params.download) {
    // A service worker has no URL.createObjectURL, so the CSV goes to the
    // downloads API as a data: URL.
    await chrome.downloads.download({
      url: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`,
      filename,
      saveAs: true,
    });
    out.downloaded = true;
  }

  return out;
}

/* ================================================================== */
/*  sync.pull                                                         */
/* ================================================================== */

/**
 * Everything that changed since `since`.
 * @returns {Promise<{profiles, lists, listMembers, campaigns, enrollments, actions, threads, messages, events}>}
 */
export async function pull({ since = 0 } = {}) {
  const allLists = await get(K.LISTS, []);
  const campaigns = await readCampaigns();

  const listMembers = [];
  for (const list of allLists) {
    const members = await get(K.listMembers(list.listId), []);
    for (const member of sinceFilter(members, since)) {
      listMembers.push({ ...member, listId: list.listId });
    }
  }

  const enrollments = [];
  for (const campaign of campaigns) {
    for (const enrollment of sinceFilter(await readEnrollments(campaign.campaignId), since)) {
      enrollments.push({ ...enrollment, campaignId: campaign.campaignId });
    }
  }

  const { threads, messages } = await inbox.exportAll({ since });

  return {
    profiles: await profilesSince(since),
    lists: sinceFilter(allLists, since),
    listMembers,
    campaigns: sinceFilter(campaigns, since),
    enrollments,
    actions: await actionsSince(since),
    threads,
    messages,
    events: await recentEvents(since),
  };
}

register(ACTIONS.EXPORT_CSV, (params) => exportCsv(params));
register(ACTIONS.SYNC_PULL, (params) => pull(params));
