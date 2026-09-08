/**
 * LinkedIn Toolkit — Voyager endpoints.
 *
 * Every LinkedIn call the engine makes lives here, using the user's own
 * logged-in session. Paths that LinkedIn changes from time to time are all in
 * the `ENDPOINTS` catalogue below so a smoke test has exactly one place to
 * check. Response shaping lives in `voyager-normalize.js`; the transport lives
 * in `voyager-core.js`.
 */

import { ERROR, EngineError } from '../lib/actions.js';
import { LINKEDIN_BASE, generateTrackingId, qs, voyagerFetch } from './voyager-core.js';
import {
  normalizeComments,
  normalizeCompany,
  normalizeConversations,
  normalizeMessages,
  normalizePosts,
  normalizeProfileView,
  normalizeProfileCollection,
  normalizeReactions,
  normalizeRecruiterSearch,
  normalizeSalesNavSearch,
  normalizeSearchClusters,
  normalizeSentInvitations,
  normalizeTotal,
  threadIdFromUrn,
} from './voyager-normalize.js';

export * from './voyager-core.js';
export * from './voyager-normalize.js';

/* ================================================================== */
/*  Endpoint catalogue — the only place a LinkedIn path is written     */
/* ================================================================== */

export const ENDPOINTS = Object.freeze({
  /** Full profile view; `{publicId}` is substituted. */
  profileView: '/identity/profiles/{publicId}/profileView',
  searchClusters: '/search/dash/clusters',
  salesNavSearch: `${LINKEDIN_BASE}/sales-api/salesApiPeopleSearch`,
  recruiterSearch: `${LINKEDIN_BASE}/talent/api/talentRecruiterSearch`,
  companies: '/organization/companies',
  reactions: '/feed/reactions',
  comments: '/feed/comments',
  groupMemberships: '/groups/groupMemberships',
  eventAttendees: '/events/dash/professionalEventAttendees',
  connections: '/relationships/dash/connections',
  followers: '/identity/dash/profileFollowers',
  conversations: '/messaging/conversations',
  conversationEvents: '/messaging/conversations/{threadId}/events',
  memberPosts: '/identity/profileUpdatesV2',
  followingStates: '/feed/dash/followingStates',
  normInvitations: '/growth/normInvitations',
});

const SEARCH_DECORATION =
  'com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186';

/* ================================================================== */
/*  URL parsing                                                       */
/* ================================================================== */

/** `https://www.linkedin.com/feed/update/urn:li:activity:123/` → the urn. */
export function activityUrnFromUrl(postUrl) {
  const str = String(postUrl || '');
  const direct = str.match(/urn:li:(?:activity|ugcPost|share):(\d+)/);
  if (direct) return `urn:li:activity:${direct[1]}`;
  const legacy = str.match(/activity[-:](\d{10,})/);
  if (legacy) return `urn:li:activity:${legacy[1]}`;
  throw new EngineError(
    ERROR.INVALID_PARAMS,
    'Could not read an activity urn from that post URL.',
    { howToFix: 'Use the post permalink, e.g. .../feed/update/urn:li:activity:1234567890/' },
  );
}

export function groupUrnFromUrl(groupUrl) {
  const match = String(groupUrl || '').match(/\/groups\/(\d+)/);
  if (!match) throw new EngineError(ERROR.INVALID_PARAMS, 'Could not read a group id from that URL.');
  return `urn:li:group:${match[1]}`;
}

export function eventUrnFromUrl(eventUrl) {
  const match = String(eventUrl || '').match(/\/events\/(?:[^/]*?-)?(\d{6,})/);
  if (!match) throw new EngineError(ERROR.INVALID_PARAMS, 'Could not read an event id from that URL.');
  return `urn:li:event:${match[1]}`;
}

/** `urn:li:fsd_profile:ACoAAA…` → `ACoAAA…` */
export function urnId(urn) {
  const str = String(urn || '');
  const match = str.match(/:([^:()]+)\)?$/);
  return match ? match[1] : str;
}

/* ================================================================== */
/*  Search                                                            */
/* ================================================================== */

function searchQuery({ keywords, title, company, location, currentCompany, connectionOf, network }) {
  const params = ['resultType:List(PEOPLE)'];
  if (title) params.push(`title:List(${title})`);
  if (company) params.push(`company:List(${company})`);
  if (currentCompany) params.push(`currentCompany:List(${currentCompany})`);
  if (location) params.push(`geoUrn:List(${location})`);
  if (connectionOf) params.push(`connectionOf:List(${connectionOf})`);
  if (network) params.push(`network:List(${network})`);

  const bits = ['flagshipSearchIntent:SEARCH_SRP'];
  if (keywords) bits.unshift(`keywords:${keywords}`);
  bits.push(`queryParameters:(${params.join(',')})`);
  return `(${bits.join(',')})`;
}

async function runSearch(query, { start = 0, count = 25 } = {}) {
  const search = qs({
    decorationId: SEARCH_DECORATION,
    origin: 'GLOBAL_SEARCH_HEADER',
    q: 'all',
    query,
    start,
    count,
  });
  return voyagerFetch(`${ENDPOINTS.searchClusters}?${search}`);
}

/**
 * People search across the three sources.
 * @returns {Promise<{profiles: Profile[], total?: number, nextStart?: number}>}
 */
export async function searchProfiles({
  keywords,
  title,
  company,
  location,
  source = 'search',
  start = 0,
  count = 25,
} = {}) {
  if (source === 'salesnav') return salesNavSearch({ keywords, title, company, location, start, count });
  if (source === 'recruiter') return recruiterSearch({ keywords, title, company, location, start, count });

  const raw = await runSearch(searchQuery({ keywords, title, company, location }), { start, count });
  const { profiles, total } = normalizeSearchClusters(raw, 'search');
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

/** Sales Navigator people search. */
export async function salesNavSearch({ keywords, title, company, location, start = 0, count = 25 } = {}) {
  const search = qs({ q: 'peopleSearchQuery', keywords, title, company, location, start, count });
  const raw = await voyagerFetch(`${ENDPOINTS.salesNavSearch}?${search}`);
  const { profiles, total } = normalizeSalesNavSearch(raw);
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

/** LinkedIn Recruiter search. */
export async function recruiterSearch({ keywords, title, company, location, start = 0, count = 25 } = {}) {
  const search = qs({ q: 'recruiterSearch', keywords, title, company, location, start, count });
  const raw = await voyagerFetch(`${ENDPOINTS.recruiterSearch}?${search}`);
  const { profiles, total } = normalizeRecruiterSearch(raw);
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

/* ================================================================== */
/*  Profile                                                           */
/* ================================================================== */

/** Raw `profileView` response for a public identifier. */
export async function getProfile(publicId) {
  return voyagerFetch(ENDPOINTS.profileView.replace('{publicId}', encodeURIComponent(publicId)));
}

/** Fetch and normalize a profile. */
export async function getProfileNormalized(publicId, source = 'profile') {
  return normalizeProfileView(await getProfile(publicId), source);
}

/**
 * Register a profile view.
 *
 * The authenticated `profileView` fetch is itself what LinkedIn records as a
 * visit, so there is nothing else to do.
 */
export async function viewProfile(publicId) {
  return normalizeProfileView(await getProfile(publicId), 'visit');
}

/* ================================================================== */
/*  Company                                                           */
/* ================================================================== */

export async function getCompany(universalName) {
  const raw = await voyagerFetch(
    `${ENDPOINTS.companies}?${qs({ q: 'universalName', universalName, decorate: true })}`,
  );
  const company = normalizeCompany(raw);
  if (!company.name) throw new EngineError(ERROR.NOT_FOUND, `Company ${universalName} not found.`);
  return company;
}

export async function getCompanyEmployees({ universalName, start = 0, count = 25 }) {
  const raw = await runSearch(searchQuery({ currentCompany: universalName }), { start, count });
  const { profiles, total } = normalizeSearchClusters(raw, 'company-employees');
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

/* ================================================================== */
/*  Post engagers                                                     */
/* ================================================================== */

async function fetchReactions(threadUrn, start, count) {
  const raw = await voyagerFetch(
    `${ENDPOINTS.reactions}?${qs({ q: 'reactionType', threadUrn, start, count })}`,
  );
  return normalizeReactions(raw);
}

async function fetchComments(threadUrn, start, count) {
  const raw = await voyagerFetch(
    `${ENDPOINTS.comments}?${qs({ q: 'comments', sortOrder: 'RELEVANCE', threadUrn, start, count })}`,
  );
  return normalizeComments(raw);
}

/**
 * Who liked and/or commented on a post.
 * @returns {Promise<{engagers: Engager[], nextStart?: number}>}
 */
export async function getPostEngagers({ postUrl, kind = 'both', start = 0, count = 25 }) {
  const threadUrn = activityUrnFromUrl(postUrl);
  const engagers = [];

  if (kind === 'likes' || kind === 'both') engagers.push(...(await fetchReactions(threadUrn, start, count)));
  if (kind === 'comments' || kind === 'both') engagers.push(...(await fetchComments(threadUrn, start, count)));

  const seen = new Map();
  for (const e of engagers) {
    const existing = seen.get(e.publicId);
    seen.set(e.publicId, existing ? { ...existing, ...e } : e);
  }
  const merged = [...seen.values()];
  return { engagers: merged, nextStart: merged.length ? start + count : undefined };
}

/* ================================================================== */
/*  Audiences                                                         */
/* ================================================================== */

export async function getGroupMembers({ groupUrl, start = 0, count = 25 }) {
  const groupUrn = groupUrnFromUrl(groupUrl);
  const raw = await voyagerFetch(
    `${ENDPOINTS.groupMemberships}?${qs({ q: 'group', groupUrn, start, count })}`,
  );
  const { profiles, total } = normalizeProfileCollection(raw, 'group');
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

export async function getEventAttendees({ eventUrl, start = 0, count = 25 }) {
  const eventUrn = eventUrnFromUrl(eventUrl);
  const raw = await voyagerFetch(
    `${ENDPOINTS.eventAttendees}?${qs({ q: 'eventAttendees', eventUrn, start, count })}`,
  );
  const { profiles, total } = normalizeProfileCollection(raw, 'event');
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

export async function getConnections({ start = 0, count = 25 } = {}) {
  const raw = await voyagerFetch(
    `${ENDPOINTS.connections}?${qs({ q: 'search', sortType: 'RECENTLY_ADDED', start, count })}`,
  );
  const { profiles, total } = normalizeProfileCollection(raw, 'connections');
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

export async function getFollowers({ start = 0, count = 25 } = {}) {
  const raw = await voyagerFetch(
    `${ENDPOINTS.followers}?${qs({ q: 'followersOfViewer', start, count })}`,
  );
  const { profiles, total } = normalizeProfileCollection(raw, 'followers');
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

/* ================================================================== */
/*  Messaging                                                         */
/* ================================================================== */

export async function getConversations({ count = 20, createdBefore } = {}) {
  const raw = await voyagerFetch(
    `${ENDPOINTS.conversations}?${qs({ keyVersion: 'LEGACY_INBOX', count, createdBefore })}`,
  );
  return { threads: normalizeConversations(raw) };
}

export async function getConversationMessages({ threadId, count = 20, createdBefore }) {
  const id = threadIdFromUrn(threadId);
  const path = ENDPOINTS.conversationEvents.replace('{threadId}', encodeURIComponent(id));
  const raw = await voyagerFetch(`${path}?${qs({ count, createdBefore })}`);
  return { messages: normalizeMessages(raw, id) };
}

/* ================================================================== */
/*  Activity and graph                                                */
/* ================================================================== */

export async function getMemberPosts({ publicId, profileUrn, count = 10 } = {}) {
  const raw = await voyagerFetch(
    `${ENDPOINTS.memberPosts}?${qs({
      q: 'memberShareFeed',
      moduleKey: 'member-shares:phone',
      includeLongTermHistory: true,
      numComments: 0,
      numLikes: 0,
      count,
      profileUrn,
      publicIdentifier: profileUrn ? undefined : publicId,
    })}`,
  );
  return normalizePosts(raw);
}

/** How many connections we share with a profile. */
export async function getMutualConnectionsCount({ profileUrn }) {
  const raw = await runSearch(
    searchQuery({ connectionOf: urnId(profileUrn), network: 'F' }),
    { start: 0, count: 0 },
  );
  return normalizeTotal(raw);
}

/* ================================================================== */
/*  Writes                                                            */
/* ================================================================== */

export function toFsdProfileUrn(urn) {
  const str = String(urn || '');
  if (!str) return '';
  if (str.includes('fsd_profile')) return str;
  return str.replace('fs_miniProfile', 'fsd_profile').replace('fs_profile', 'fsd_profile');
}

/**
 * Invitations we have sent that are still pending.
 *
 * One cheap call that answers "did they accept?" for everybody at once, with
 * no profile views spent. This is the endpoint `network.status` and the
 * campaign 'accepted' branch lean on.
 *
 * @returns {Promise<{publicId: string, invitationUrn: string, sentAt?: number}[]>}
 */
export async function getSentInvitations({ start = 0, count = 100 } = {}) {
  const raw = await voyagerFetch(
    `${ENDPOINTS.normInvitations}?${qs({ q: 'sentInvitationsV2', start, count })}`,
  );
  return normalizeSentInvitations(raw);
}

/** Resolve a profile urn from a public identifier when the caller has none. */
export async function resolveProfileUrn(publicId) {
  const profile = await getProfileNormalized(publicId);
  const urn = toFsdProfileUrn(profile.urn);
  if (!urn) throw new EngineError(ERROR.NOT_FOUND, `Could not resolve a profile urn for ${publicId}.`);
  return urn;
}

/** Send a connection invitation (note ≤ 300 characters). */
export async function sendInvite({ publicId, publicIdentifier, profileUrn, note }) {
  const id = publicId || publicIdentifier;
  const urn = toFsdProfileUrn(profileUrn) || (await resolveProfileUrn(id));
  const body = { inviteeProfileUrn: urn, trackingId: generateTrackingId() };
  if (note) body.message = String(note).slice(0, 300);
  return voyagerFetch(ENDPOINTS.normInvitations, { method: 'POST', body });
}

/** Send a message (`subtype: 'INMAIL'` for an InMail). */
export async function sendMessage({
  recipientUrn,
  body,
  subtype = 'MEMBER_TO_MEMBER',
  inmailSubject,
}) {
  if (!recipientUrn) throw new EngineError(ERROR.INVALID_PARAMS, 'recipientUrn is required.');
  if (!body) throw new EngineError(ERROR.INVALID_PARAMS, 'Message body cannot be empty.');

  const message = {
    attributedBody: { text: body, attributes: [] },
    attachments: [],
  };
  if (subtype === 'INMAIL' && inmailSubject) message.subject = inmailSubject;

  const payload = {
    keyVersion: 'LEGACY_INBOX',
    conversationCreate: {
      eventCreate: {
        value: { 'com.linkedin.voyager.messaging.create.MessageCreate': message },
      },
      recipients: [toFsdProfileUrn(recipientUrn)],
      subtype: subtype === 'INMAIL' ? 'INMAIL' : 'MEMBER_TO_MEMBER',
    },
  };

  return voyagerFetch(`${ENDPOINTS.conversations}?action=create`, { method: 'POST', body: payload });
}

/** Send an InMail. */
export async function sendInMail({ recipientUrn, subject, body }) {
  return sendMessage({ recipientUrn, body, subtype: 'INMAIL', inmailSubject: subject });
}

/** Follow (or unfollow) a member without connecting. */
export async function follow({ publicId, profileUrn, following = true }) {
  const urn = toFsdProfileUrn(profileUrn) || (await resolveProfileUrn(publicId));
  const stateUrn = encodeURIComponent(`urn:li:fsd_followingState:${urn}`);
  return voyagerFetch(`${ENDPOINTS.followingStates}/${stateUrn}?action=toggleFollow`, {
    method: 'POST',
    body: { patch: { $set: { following: !!following } } },
  });
}

/** Like a post. */
export async function likePost({ postUrl, reactionType = 'LIKE' }) {
  const threadUrn = activityUrnFromUrl(postUrl);
  return voyagerFetch(`${ENDPOINTS.reactions}?${qs({ threadUrn })}`, {
    method: 'POST',
    body: { reactionType, threadUrn },
  });
}

/** Comment on a post. */
export async function commentPost({ postUrl, body }) {
  const threadUrn = activityUrnFromUrl(postUrl);
  if (!body) throw new EngineError(ERROR.INVALID_PARAMS, 'Comment body cannot be empty.');
  return voyagerFetch(`${ENDPOINTS.comments}?${qs({ threadUrn })}`, {
    method: 'POST',
    body: {
      threadUrn,
      commentary: { text: body, attributes: [] },
      trackingId: generateTrackingId(),
    },
  });
}

