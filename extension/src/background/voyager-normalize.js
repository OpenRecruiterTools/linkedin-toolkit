/**
 * LinkedIn Toolkit — Voyager response normalizers.
 *
 * Every function here is pure: raw Voyager JSON in, a contract type out
 * (`Profile`, `Company`, `Engager`, `Thread`, `Message`).
 *
 * All of them read the "normalized" envelope — `{ data, included }` with `*`
 * references between the two — through the four helpers in `normalized.js`,
 * so a response whose collection moved from `data.elements` to
 * `data.data.<queryName>.*elements` needs no change here.
 *
 * Two rules run through the file:
 *
 * 1. **Never invent.** A field LinkedIn did not send is left empty rather than
 *    guessed at. The live example is structured experience: no profile
 *    decoration carries positions any more, and the positions query returns
 *    company references with no titles or dates, so the engine reads the
 *    rendered profile *sections* instead — and when a section does not come
 *    back, `experience`, `education` and `skills` stay empty rather than
 *    being filled from something that only looks like them.
 * 2. **Never claim a degree we do not have.** `connectionDegree` is absent
 *    from shapes that carry no distance, so a merge keeps whatever is already
 *    known; only a profile read is entitled to say `null` ("we looked and
 *    could not tell").
 */

import {
  elements,
  entitiesOfType,
  field,
  index,
  resolve,
  textOf,
  total,
} from './normalized.js';

/* ------------------------------------------------------------------ */
/*  Small helpers                                                     */
/* ------------------------------------------------------------------ */

export function publicIdFromUrl(url) {
  const match = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export function profileUrl(publicId) {
  return publicId ? `https://www.linkedin.com/in/${publicId}/` : '';
}

/**
 * `DISTANCE_2` → 2.
 *
 * `SELF` is deliberately not a degree: it is us, and answering `1` there would
 * make our own profile look like a first-degree connection. Anything
 * unrecognised returns `undefined`, which callers read as "not stated".
 */
export function degreeOf(distance) {
  const value = typeof distance === 'string' ? distance : distance && distance.value;
  const map = { DISTANCE_1: 1, DISTANCE_2: 2, DISTANCE_3: 3, OUT_OF_NETWORK: 3 };
  return map[value] || undefined;
}

/** Pull the `urn:li:fsd_profile:…` out of any urn that embeds one. */
export function fsdProfileUrnIn(urn) {
  const match = String(urn || '').match(/urn:li:fsd_profile:[^,)\s]+/);
  return match ? match[0] : '';
}

function vectorImageUrl(image) {
  if (!image) return '';
  const vector =
    image.vectorImage ||
    (image.displayImageReference && image.displayImageReference.vectorImage) ||
    image;
  const root = vector.rootUrl || '';
  const artifacts = vector.artifacts || [];
  const last = artifacts[artifacts.length - 1];
  const segment = last && last.fileIdentifyingUrlPathSegment;
  return segment ? `${root}${segment}` : '';
}

const text = textOf;

/* ------------------------------------------------------------------ */
/*  Profile                                                           */
/* ------------------------------------------------------------------ */

/** Shape any partially-known person into the contract `Profile`. */
export function toProfile(fields = {}, source = 'profile') {
  const publicId = fields.publicId || fields.publicIdentifier || publicIdFromUrl(fields.url);
  const firstName = fields.firstName || '';
  const lastName = fields.lastName || '';
  const profile = {
    publicId,
    urn: fields.urn || fields.entityUrn || fields.objectUrn || '',
    url: fields.url || profileUrl(publicId),
    firstName,
    lastName,
    fullName: fields.fullName || `${firstName} ${lastName}`.trim(),
    headline: fields.headline || '',
    title: fields.title || '',
    company: fields.company || '',
    location: fields.location || '',
    industry: fields.industry || '',
    photoUrl: fields.photoUrl || '',
    skills: fields.skills || [],
    experience: fields.experience || [],
    education: fields.education || [],
    capturedAt: fields.capturedAt || Date.now(),
    source,
  };
  if (fields.companyUrn) profile.companyUrn = fields.companyUrn;

  // `undefined` means this shape does not carry a distance at all — a
  // follower, a group member, a reaction — and must leave whatever we already
  // know alone. Only a full profile read is entitled to say `null`, meaning
  // "we looked and could not tell"; that one is passed in explicitly below.
  if (fields.connectionDegree !== undefined) {
    profile.connectionDegree = fields.connectionDegree;
  }
  if (fields.summary) profile.summary = fields.summary;
  if (fields.pageText) profile.pageText = fields.pageText;
  if (fields.photoDataUrl) profile.photoDataUrl = fields.photoDataUrl;
  return profile;
}

/** A `miniProfile` (messaging, invitations, legacy collections) → `Profile`. */
export function miniProfileToProfile(mini, source = 'profile') {
  if (!mini) return null;
  return toProfile(
    {
      publicId: mini.publicIdentifier || publicIdFromUrl(mini.publicProfileUrl || mini.profileUrl),
      urn: mini.dashEntityUrn || mini.entityUrn || mini.objectUrn,
      firstName: text(mini.firstName),
      lastName: text(mini.lastName),
      headline: text(mini.occupation || mini.headline),
      photoUrl: vectorImageUrl(mini.picture || mini.profilePicture),
      location:
        mini.location ||
        (mini.geoLocation && mini.geoLocation.geo && mini.geoLocation.geo.defaultLocalizedName) ||
        '',
      connectionDegree: degreeOf(mini.distance),
    },
    source,
  );
}

/**
 * A dash `Profile` entity (`identity/dash/profiles`, the connections list) →
 * the contract fields, with `*geo` and `*industry` followed through `included`.
 */
function dashProfileFields(profile, idx) {
  const geo = profile.geoLocation ? field(profile.geoLocation, 'geo', idx) : null;
  const industry = field(profile, 'industry', idx);
  return {
    publicId: profile.publicIdentifier,
    urn: profile.entityUrn,
    firstName: profile.firstName,
    lastName: profile.lastName,
    headline: profile.headline,
    summary: profile.summary || '',
    location: (geo && geo.defaultLocalizedName) || profile.locationName || '',
    industry: (industry && industry.name) || profile.industryName || '',
    photoUrl: vectorImageUrl(profile.profilePicture),
  };
}

/**
 * The degree, read off the `MemberRelationship` the top-card decoration
 * includes. This is the only place in the current API that states it for one
 * person, which is why a profile read asks for that decoration.
 */
function relationshipDegree(raw) {
  const [relationship] = entitiesOfType(raw, 'relationships.MemberRelationship');
  if (!relationship) return undefined;
  const union =
    relationship.memberRelationshipUnion || relationship.memberRelationshipData || relationship;
  if (union.connection) return 1;
  if (union.noConnection) return degreeOf(union.noConnection.memberDistance);
  if (union.selfProfile) return undefined;
  return degreeOf(union.memberDistance);
}

/**
 * An `identity/dash/profiles?q=memberIdentity` response → contract `Profile`.
 *
 * Works for both decorations the engine asks for: the top card (identity plus
 * the member relationship, so the degree) and the full profile (summary and
 * industry). The response includes more than one `Profile` — the top card also
 * carries *us*, as the potential inviter — so the subject is taken from the
 * collection's `*elements` reference rather than by picking the first match.
 */
export function normalizeProfileView(raw, source = 'profile') {
  const idx = index(raw);
  const profile =
    elements(raw, idx).find((e) => e && e.publicIdentifier) ||
    elements(raw, idx)[0] ||
    entitiesOfType(raw, 'identity.profile.Profile')[0] ||
    {};

  const degree = relationshipDegree(raw);

  return toProfile(
    {
      ...dashProfileFields(profile, idx),
      // A profile read is the one shape that always knows: an unparsable
      // distance here is a real "could not tell", not an absent field, and it
      // must overwrite whatever degree we were holding.
      connectionDegree: degree ?? null,
      // LinkedIn no longer serves positions, schools or skills on any endpoint
      // we have identified. Empty is the honest answer; `profile.get
      // { full: true }` fills the gap from the page itself.
      skills: [],
      experience: [],
      education: [],
    },
    source,
  );
}

/**
 * Merge a second decoration's read into the first.
 *
 * The top card knows the degree; the full profile knows the summary and the
 * industry. Neither is a superset, so `profile.get { full: true }` reads both
 * and this puts them together — taking a value from `extra` only where the
 * base does not have one, so the base decoration stays authoritative.
 */
export function mergeProfiles(base, extra) {
  if (!extra) return base;
  if (!base) return extra;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const current = out[key];
    const empty =
      current === undefined ||
      current === null ||
      current === '' ||
      (Array.isArray(current) && current.length === 0);
    if (empty) out[key] = value;
  }
  // The degree is the top card's to state, including when it states `null`.
  if ('connectionDegree' in base) out.connectionDegree = base.connectionDegree;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Profile sections (experience, education, skills)                  */
/* ------------------------------------------------------------------ */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** `Jan 2015`, `2015` and `Present` — the three things a caption ever says. */
function parseMonthYear(value) {
  const str = String(value || '').trim();
  if (!str || /^present$/i.test(str)) return undefined;
  const monthYear = str.match(/^([A-Za-z]{3,})\s+(\d{4})$/);
  if (monthYear) {
    const month = MONTHS.indexOf(monthYear[1].slice(0, 3).toLowerCase());
    if (month >= 0) return Date.UTC(Number(monthYear[2]), month, 1);
  }
  const year = str.match(/^(\d{4})$/);
  return year ? Date.UTC(Number(year[1]), 0, 1) : undefined;
}

/**
 * `"2000 - Present · 26 yrs 9 mos"` → `{ start, end }`.
 *
 * The duration after the middle dot is LinkedIn's own arithmetic and is
 * dropped; an open-ended range leaves `end` undefined, which is what the rest
 * of the engine reads as "current role".
 */
export function parseDateRange(caption) {
  const range = String(caption || '').split('·')[0].trim();
  const [from, to] = range.split(/\s+[-–]\s+/);
  return { start: parseMonthYear(from), end: parseMonthYear(to) };
}

function companyUrnOf(entity) {
  const attributes = (entity.image && entity.image.attributes) || [];
  for (const attribute of attributes) {
    const detail = attribute.detailData || {};
    const urn = detail['*companyLogo'] || detail.companyLogo;
    if (typeof urn === 'string') return urn;
  }
  const target = String(entity.textActionTarget || '').match(/\/company\/(\d+)/);
  return target ? `urn:li:fsd_company:${target[1]}` : '';
}

function entityComponentToEntry(entity) {
  return {
    title: text(entity.titleV2) || text(entity.title),
    subtitle: text(entity.subtitle) || text(entity.subtitleV2),
    caption: text(entity.caption),
    metadata: text(entity.metadata),
    companyUrn: companyUrnOf(entity),
  };
}

/**
 * `voyagerIdentityDashProfileComponents` → flat `{ title, subtitle, caption }`
 * rows, whatever section was asked for.
 *
 * LinkedIn renders every profile section through the same component tree: the
 * response holds one component per section which references a
 * `PagedListComponent` in `included`, and each of *its* elements holds an
 * `entityComponent` carrying the three lines the page shows. Reading those
 * three lines is deliberately all this does — the tree is a rendering format
 * and anything deeper would be guessing at how it will be laid out next month.
 */
export function normalizeProfileSection(raw) {
  const idx = index(raw);
  const out = [];
  const seen = new Set();

  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 4) return;

    const paged = field(node, 'pagedListComponent', idx);
    if (paged && !seen.has(paged)) {
      seen.add(paged);
      const inner = paged.components || {};
      const list = Array.isArray(inner.elements) ? inner.elements : [];
      for (const element of list) visit(element.components || element, depth + 1);
      return;
    }

    if (node.entityComponent) {
      out.push(entityComponentToEntry(node.entityComponent));
      return;
    }

    if (node.components) visit(node.components, depth + 1);
  };

  for (const element of elements(raw, idx)) visit(element.components || element, 0);
  return out;
}

/** Section rows → contract `Profile.experience`. */
export function sectionToExperience(entries) {
  return (entries || [])
    .map((e) => {
      const { start, end } = parseDateRange(e.caption);
      const position = {
        title: e.title || '',
        company: e.subtitle || '',
        start,
        end,
        description: '',
      };
      if (e.companyUrn) position.companyUrn = e.companyUrn;
      return position;
    })
    .filter((p) => p.title || p.company);
}

/**
 * Section rows → contract `Profile.education`.
 *
 * LinkedIn writes the second line as `"<degree>, <field of study>"`, so the
 * first comma splits them; a line without one is taken as the degree whole.
 */
export function sectionToEducation(entries) {
  return (entries || [])
    .map((e) => {
      const { start, end } = parseDateRange(e.caption);
      const subtitle = e.subtitle || '';
      const comma = subtitle.indexOf(', ');
      return {
        school: e.title || '',
        degree: comma > 0 ? subtitle.slice(0, comma) : subtitle,
        field: comma > 0 ? subtitle.slice(comma + 2) : '',
        start,
        end,
      };
    })
    .filter((e) => e.school);
}

/** Section rows → contract `Profile.skills`. */
export function sectionToSkills(entries) {
  return (entries || []).map((e) => e.title).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/*  Search                                                            */
/* ------------------------------------------------------------------ */

/**
 * One `EntityResultViewModel` → `Profile`.
 *
 * This one shape backs people search, company employees and followers: the
 * name is `title.text`, the headline `primarySubtitle.text`, the location
 * `secondarySubtitle.text`, and the profile urn is embedded in `entityUrn`
 * (`trackingUrn` is a `urn:li:member:` id, which is not what the rest of the
 * engine speaks).
 */
function entityResultToProfile(entity, source) {
  const navigationUrl =
    entity.navigationUrl || (entity.navigationContext && entity.navigationContext.url) || '';
  const publicId = publicIdFromUrl(navigationUrl);
  const headline = text(entity.primarySubtitle);
  const atIndex = headline.lastIndexOf(' at ');
  const tracking = entity.entityCustomTrackingInfo || {};

  return toProfile(
    {
      publicId,
      url: publicId ? profileUrl(publicId) : navigationUrl,
      fullName: text(entity.title),
      headline,
      title: atIndex > 0 ? headline.slice(0, atIndex) : headline,
      company: atIndex > 0 ? headline.slice(atIndex + 4) : '',
      location: text(entity.secondarySubtitle),
      urn: fsdProfileUrnIn(entity.entityUrn) || entity.trackingUrn || '',
      // A list read may *confirm* a connection but must never demote one. The
      // engine's acceptance check reads the stored degree, and a search page
      // that still says "2nd" for somebody who accepted an hour ago would
      // undo a confirmed acceptance and make a campaign branch flap. So only
      // the one claim that can be acted on is carried through.
      connectionDegree: degreeOf(tracking.memberDistance) === 1 ? 1 : undefined,
    },
    source,
  );
}

/**
 * A `voyagerSearchDashClusters` response → `{ profiles, total }`.
 *
 * The clusters carry only `*entityResult` references; the view models
 * themselves live in `included`, so they are read from there directly. That
 * also makes the normalizer indifferent to how many clusters LinkedIn splits
 * the page into.
 */
export function normalizeSearchClusters(raw, source = 'search') {
  const profiles = [];
  for (const entity of entitiesOfType(raw, 'search.EntityResultViewModel')) {
    const profile = entityResultToProfile(entity, source);
    if (profile.publicId || profile.fullName) profiles.push(profile);
  }

  // Older captures (and the hand-written fixtures for endpoints we have not
  // been able to verify) inline the entity results inside the clusters.
  if (!profiles.length) {
    const idx = index(raw);
    for (const cluster of elements(raw, idx)) {
      for (const item of cluster.items || cluster.results || []) {
        const entity =
          resolve(item.item && item.item['*entityResult'], idx) ||
          (item.item && item.item.entityResult) ||
          item.entityResult ||
          item.entity ||
          item;
        if (!entity || !entity.navigationUrl) continue;
        const profile = entityResultToProfile(entity, source);
        if (profile.publicId || profile.fullName) profiles.push(profile);
      }
    }
  }

  return { profiles, total: total(raw) };
}

/** Sales Navigator people search → `{ profiles, total }`. Unverified shape. */
export function normalizeSalesNavSearch(raw) {
  const list = (raw && raw.elements) || [];
  const profiles = list.map((e) => {
    const position = (e.currentPositions && e.currentPositions[0]) || {};
    return toProfile(
      {
        publicId: publicIdFromUrl(e.publicProfileUrl),
        url: e.publicProfileUrl,
        firstName: e.firstName,
        lastName: e.lastName,
        fullName: e.fullName,
        headline: position.title
          ? `${position.title} at ${position.companyName || ''}`.trim()
          : e.headline || '',
        title: position.title || '',
        company: position.companyName || '',
        companyUrn: position.companyUrn || '',
        location: e.geoRegion || e.location || '',
        industry: e.industry || '',
        urn: e.entityUrn || '',
        connectionDegree: e.degree,
      },
      'salesnav',
    );
  });
  return { profiles, total: raw && raw.paging ? raw.paging.total : undefined };
}

/** Recruiter search → `{ profiles, total }`. Unverified shape. */
export function normalizeRecruiterSearch(raw) {
  const list = (raw && raw.elements) || [];
  const profiles = list.map((e) => {
    const p = e.profile || e;
    const position = (p.currentPositions && p.currentPositions[0]) || {};
    return toProfile(
      {
        publicId: publicIdFromUrl(p.publicProfileUrl),
        url: p.publicProfileUrl,
        firstName: p.firstName,
        lastName: p.lastName,
        headline: p.headline || '',
        title: position.title || '',
        company: position.companyName || '',
        location: p.location || '',
        urn: p.entityUrn || '',
      },
      'recruiter',
    );
  });
  return { profiles, total: raw && raw.paging ? raw.paging.total : undefined };
}

/* ------------------------------------------------------------------ */
/*  Collections of people                                             */
/* ------------------------------------------------------------------ */

/**
 * `relationships/dash/connections` → `{ profiles, total }`.
 *
 * Each element is a `Connection` holding the date and a reference to the
 * member's `Profile`; being in this collection *is* the answer to "what
 * degree", so the degree is stated rather than inferred.
 */
export function normalizeConnections(raw) {
  const idx = index(raw);
  const profiles = [];

  for (const connection of elements(raw, idx)) {
    const person =
      field(connection, 'connectedMemberResolutionResult', idx) ||
      resolve(connection.connectedMember, idx) ||
      (connection.publicIdentifier ? connection : null);
    if (!person) continue;

    const profile = toProfile(
      { ...dashProfileFields(person, idx), connectionDegree: 1 },
      'connections',
    );
    if (!profile.publicId) continue;
    if (connection.createdAt) profile.connectedAt = connection.createdAt;
    profiles.push(profile);
  }

  return { profiles, total: total(raw) };
}

const PROFILE_WRAPPERS = [
  'connectedMemberResolutionResult',
  'followerProfile',
  'memberProfile',
  'profile',
  'miniProfile',
  'entity',
];

/**
 * Group members and event attendees: an `elements` list wrapping a profile
 * under one of a handful of field names.
 *
 * Both endpoints are **unverified** against the current client — see
 * `docs/voyager-endpoints.md` — so this stays deliberately forgiving and the
 * caller turns an unrecognised body into a `LINKEDIN_ERROR` rather than a
 * silently empty list.
 */
export function normalizeProfileCollection(raw, source = 'network') {
  const idx = index(raw);
  const profiles = [];

  for (const element of elements(raw, idx)) {
    let person = null;
    for (const key of PROFILE_WRAPPERS) {
      const wrapped = field(element, key, idx);
      if (wrapped) {
        person = wrapped;
        break;
      }
    }
    if (!person && element.publicIdentifier) person = element;
    if (!person) continue;

    const profile = person.$type && person.$type.endsWith('identity.profile.Profile')
      ? toProfile(dashProfileFields(person, idx), source)
      : miniProfileToProfile(person, source);
    if (!profile || !profile.publicId) continue;
    profiles.push(profile);
  }

  return { profiles, total: total(raw) };
}

/* ------------------------------------------------------------------ */
/*  Engagers                                                          */
/* ------------------------------------------------------------------ */

/** `"2nd"`, `"3rd+"` → the degree. Reactions state it as a rendered label. */
function degreeFromLabel(label) {
  const match = String(label || '').match(/^([123])(?:st|nd|rd)/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * `voyagerSocialDashReactions` → `Engager[]`.
 *
 * Each `Reaction` carries a rendered `reactorLockup` — name, headline, degree
 * label and profile link — plus the reactor's profile urn. The `Profile`
 * entities the response also includes are stubs, so the lockup is the source.
 * Its navigation url uses the obfuscated member id rather than a vanity name,
 * so that is what `publicId` holds; it is still a working profile URL and a
 * stable key.
 */
export function normalizeReactions(raw) {
  const idx = index(raw);
  const out = [];
  for (const e of elements(raw, idx)) {
    const lockup = e.reactorLockup;
    let base;

    if (lockup) {
      const publicId = publicIdFromUrl(lockup.navigationUrl);
      base = toProfile(
        {
          publicId,
          url: publicId ? profileUrl(publicId) : lockup.navigationUrl || '',
          fullName: text(lockup.title),
          headline: text(lockup.subtitle),
          urn: e.actorUrn || (e.actor && e.actor['*profileUrn']) || '',
          connectionDegree: degreeFromLabel(text(lockup.label)),
        },
        'post-engagers',
      );
    } else {
      const mini =
        (e.reactor && e.reactor['com.linkedin.voyager.feed.MemberActor']) || e.actor || null;
      base = mini ? miniProfileToProfile(mini.miniProfile || mini, 'post-engagers') : null;
    }

    if (!base || !base.publicId) continue;
    base.reaction = e.reactionType || 'LIKE';
    if (e.createdAt) base.engagedAt = e.createdAt;
    out.push(base);
  }
  return out;
}

/** Post comments → `Engager[]`. Unverified shape. */
export function normalizeComments(raw) {
  const idx = index(raw);
  const out = [];
  for (const e of elements(raw, idx)) {
    const actor =
      (e.commenter && e.commenter['com.linkedin.voyager.feed.MemberActor']) || e.commenter || {};
    const base = miniProfileToProfile(actor.miniProfile || actor, 'post-engagers');
    if (!base || !base.publicId) continue;
    base.commentText = (e.commentV2 && e.commentV2.text) || text(e.comment) || '';
    base.engagedAt = e.createdAt || undefined;
    out.push(base);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Messaging                                                         */
/* ------------------------------------------------------------------ */

/**
 * `urn:li:msg_conversation:(urn:li:fsd_profile:…,2-abc==)` → `2-abc==`.
 * A bare thread id, and the older `urn:li:fs_conversation:` form, pass
 * through unchanged.
 */
export function threadIdFromUrn(urn) {
  const str = String(urn || '');
  const tuple = str.match(/,([^,()]+)\)\s*$/);
  if (tuple) return tuple[1];
  const legacy = str.match(/urn:li:(?:fs_conversation|msg_conversation):(.+)$/);
  return legacy ? legacy[1] : str;
}

/** Rebuild the urn the messaging API wants from a stored thread id. */
export function conversationUrn(mailboxUrn, threadId) {
  const id = String(threadId || '');
  if (id.startsWith('urn:li:msg_conversation:')) return id;
  return `urn:li:msg_conversation:(${mailboxUrn},${id})`;
}

/** The member behind a messaging participant, in either shape. */
function participantPerson(participant, idx) {
  if (!participant) return null;
  const node = resolve(participant, idx) || participant;
  const member = (node.participantType && node.participantType.member) || null;

  if (member) {
    const publicId =
      member.publicIdentifier || publicIdFromUrl(member.profileUrl || member.publicProfileUrl);
    return {
      publicId,
      urn: node.hostIdentityUrn || node.entityUrn || '',
      fullName: `${text(member.firstName)} ${text(member.lastName)}`.trim(),
    };
  }

  const legacy = node['com.linkedin.voyager.messaging.MessagingMember'] || node;
  const mini = legacy.miniProfile || legacy;
  if (!mini || (!mini.publicIdentifier && !mini.firstName)) return null;
  return {
    publicId: mini.publicIdentifier || '',
    urn: mini.dashEntityUrn || mini.entityUrn || node.hostIdentityUrn || '',
    fullName: `${text(mini.firstName)} ${text(mini.lastName)}`.trim(),
  };
}

/** A message body, current (`body.text`) or legacy (`eventContent`). */
function messageBody(message) {
  if (!message) return '';
  if (message.body) return text(message.body);
  const content = message.eventContent || {};
  const legacy = content['com.linkedin.voyager.messaging.event.MessageEvent'] || content;
  return (legacy.attributedBody && legacy.attributedBody.text) || legacy.body || '';
}

function messageTime(message) {
  return (message && (message.deliveredAt || message.createdAt)) || 0;
}

/** The most recent message carried inline on a conversation, if any. */
function lastMessageOf(conversation, idx) {
  const container = conversation.messages || conversation.events;
  if (!container) return null;
  const list = Array.isArray(container)
    ? container
    : (container.elements || container['*elements'] || []).map((m) => resolve(m, idx) || m);
  if (!list.length) return null;
  return list.reduce((latest, m) => (messageTime(m) >= messageTime(latest) ? m : latest), list[0]);
}

/**
 * `messengerConversations…` → `Thread[]`.
 *
 * @param {object} raw
 * @param {string} [selfUrn] our own `fsd_profile` urn, so we are left out of
 *   the participant list
 */
export function normalizeConversations(raw, selfUrn = '') {
  const idx = index(raw);
  return elements(raw, idx).map((c) => {
    const last = lastMessageOf(c, idx);
    const people = (c.conversationParticipants || c.participants || [])
      .map((p) => participantPerson(p, idx))
      .filter(Boolean)
      .filter((p) => !selfUrn || p.urn !== selfUrn);

    return {
      threadId: threadIdFromUrn(c.entityUrn || c.conversationUrn),
      participants: people.map((p) => ({ publicId: p.publicId, fullName: p.fullName })),
      lastMessageAt: c.lastActivityAt || messageTime(last),
      unread: c.read === false || (c.unreadCount || 0) > 0,
      snippet: messageBody(last),
    };
  });
}

/**
 * `messengerMessages…` → `Message[]`, oldest first.
 *
 * `fromUrn` is carried alongside `fromPublicId` because the messaging API
 * identifies a sender by urn and only sometimes resolves the member behind it;
 * reply detection can then still tell our own messages from theirs.
 */
export function normalizeMessages(raw, threadId) {
  const idx = index(raw);
  return elements(raw, idx)
    .map((m) => {
      const from = participantPerson(m.sender || m.from, idx) || {};
      const sentAt = messageTime(m);
      const message = {
        messageId: m.entityUrn || `${threadId}:${sentAt}`,
        threadId,
        fromPublicId: from.publicId || '',
        body: messageBody(m),
        sentAt,
      };
      const urn = from.urn || (m.sender && m.sender.hostIdentityUrn) || '';
      if (urn) message.fromUrn = urn;
      return message;
    })
    .sort((a, b) => a.sentAt - b.sentAt);
}

/* ------------------------------------------------------------------ */
/*  Company                                                           */
/* ------------------------------------------------------------------ */

function sizeLabel(range, staffCount) {
  if (range && range.start) return range.end ? `${range.start}-${range.end}` : `${range.start}+`;
  return staffCount ? String(staffCount) : '';
}

/**
 * `organizationDashCompaniesByUniversalName` → contract `Company`, or `null`
 * when the response carries no company at all.
 *
 * The universal name is echoed from the request: the GraphQL query the web app
 * uses returns a thin `Company` for some organisations — sometimes little more
 * than the `entityUrn` — and the urn alone is still worth having, because it
 * is what a `currentCompany` employee search needs.
 */
export function normalizeCompany(raw, universalName = '') {
  const idx = index(raw);
  const c =
    elements(raw, idx)[0] ||
    entitiesOfType(raw, 'organization.Company')[0] ||
    (raw && raw.elements && raw.elements[0]) ||
    null;
  if (!c) return null;

  const name = c.universalName || universalName || '';
  const industry = field(c, 'industry', idx);
  return {
    universalName: name,
    urn: c.entityUrn || c.objectUrn || '',
    name: c.name || '',
    url: name ? `https://www.linkedin.com/company/${name}/` : '',
    industry:
      (c.companyIndustries && c.companyIndustries[0] && c.companyIndustries[0].localizedName) ||
      (industry && industry.name) ||
      (typeof c.industry === 'string' ? c.industry : '') ||
      '',
    size: sizeLabel(c.staffCountRange || c.employeeCountRange, c.staffCount || c.employeeCount),
    hq: c.headquarter
      ? [c.headquarter.city, c.headquarter.geographicArea, c.headquarter.country]
          .filter(Boolean)
          .join(', ')
      : '',
    website: c.websiteUrl || c.companyPageUrl || c.website || '',
    description: c.description || c.tagline || '',
    followerCount:
      (c.followingState && c.followingState.followerCount) || c.followerCount || undefined,
    capturedAt: Date.now(),
  };
}

/** The numeric company id off a company urn: `urn:li:fsd_company:1035` → 1035. */
export function companyIdFromUrn(urn) {
  const match = String(urn || '').match(/urn:li:fsd?_company:(\d+)/);
  return match ? match[1] : '';
}

/* ------------------------------------------------------------------ */
/*  Activity                                                          */
/* ------------------------------------------------------------------ */

/** A member's recent shares → `{ url, text, likes, comments, postedAt }[]`. */
export function normalizePosts(raw) {
  const idx = index(raw);
  return elements(raw, idx)
    .map((e) => {
      const social = field(e, 'socialDetail', idx) || e.socialDetail || {};
      const counts = social.totalSocialActivityCounts || e.socialCounts || {};
      const urn =
        String(e.entityUrn || '') ||
        String((e.updateMetadata && e.updateMetadata.urn) || '') ||
        String(e.preDashEntityUrn || '');
      const activity = `${urn} ${e.preDashEntityUrn || ''} ${
        (e.updateMetadata && e.updateMetadata.urn) || ''
      }`.match(/urn:li:activity:(\d+)/);

      return {
        url:
          e.permalink ||
          (activity ? `https://www.linkedin.com/feed/update/urn:li:activity:${activity[1]}/` : ''),
        text: text(e.commentary && e.commentary.text) || text(e.commentary) || '',
        likes: counts.numLikes || counts.likes || 0,
        comments: counts.numComments || counts.comments || 0,
        postedAt: e.createdAt || undefined,
      };
    })
    .filter((p) => p.url || p.text);
}

/** The `total` off a search used to count mutual connections. */
export function normalizeTotal(raw) {
  return total(raw) || 0;
}

/* ------------------------------------------------------------------ */
/*  Invitations                                                       */
/* ------------------------------------------------------------------ */

/**
 * `relationships/sentInvitationViewsV2` → the people whose invitation is still
 * outstanding.
 *
 * Each element is a thin view pointing at an `Invitation`, which points in
 * turn at the invitee's `MiniProfile`. The older inline shapes are still read
 * so a stored response from an earlier build does not break.
 */
export function normalizeSentInvitations(raw) {
  const idx = index(raw);
  const out = [];

  for (const element of elements(raw, idx)) {
    const invitation = field(element, 'invitation', idx) || element.invitation || element;
    const invitee =
      field(invitation.invitee || {}, 'miniProfile', idx) ||
      field(invitation, 'inviteeMemberResolutionResult', idx) ||
      field(invitation, 'toMember', idx) ||
      (invitation.invitee &&
        invitation.invitee['com.linkedin.voyager.growth.invitation.InviteeProfile']) ||
      invitation.invitee ||
      invitation.inviteeProfile ||
      invitation.toMember ||
      {};
    const mini = invitee.miniProfile || invitee;
    // The GraphQL view carries no vanity name on the profile it includes; the
    // card's own link is where it is written.
    const publicId =
      mini.publicIdentifier ||
      publicIdFromUrl(mini.publicProfileUrl) ||
      publicIdFromUrl(element.cardActionTarget);
    if (!publicId) continue;

    out.push({
      publicId,
      invitationUrn:
        invitation.entityUrn ||
        invitation.mailboxItemId ||
        element['*invitation'] ||
        element.entityUrn ||
        '',
      sentAt: invitation.sentTime || invitation.createdAt || undefined,
    });
  }

  return out;
}

/* Re-exported so callers can ask "did we understand this body at all?". */
export { collection, elements, hasCollection, index, resolve, textOf } from './normalized.js';
