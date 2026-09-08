/**
 * LinkedIn Toolkit — Voyager response normalizers.
 *
 * Every function here is pure: raw Voyager JSON in, a contract type out
 * (`Profile`, `Company`, `Engager`, `Thread`, `Message`). Voyager's shapes
 * drift, so each normalizer reads several plausible field paths and returns
 * the contract shape or nothing.
 */

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

export function degreeOf(distance) {
  const value = typeof distance === 'string' ? distance : distance && distance.value;
  const map = { DISTANCE_1: 1, DISTANCE_2: 2, DISTANCE_3: 3, SELF: 1 };
  return map[value] || undefined;
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

function dateToMs(d) {
  if (!d || !d.year) return undefined;
  return Date.UTC(d.year, (d.month || 1) - 1, d.day || 1);
}

const text = (v) => (v && typeof v === 'object' ? v.text || '' : v || '');

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

  // `undefined` means this shape does not carry a distance at all — a search
  // hit, a group member, a reaction — and must leave whatever we already know
  // alone. Only a full profile read is entitled to say `null`, meaning "we
  // looked and could not tell"; that one is passed in explicitly below.
  if (fields.connectionDegree !== undefined) {
    profile.connectionDegree = fields.connectionDegree;
  }
  if (fields.summary) profile.summary = fields.summary;
  if (fields.pageText) profile.pageText = fields.pageText;
  if (fields.photoDataUrl) profile.photoDataUrl = fields.photoDataUrl;
  return profile;
}

/** A `miniProfile` (messaging, comments, event attendees) → `Profile`. */
export function miniProfileToProfile(mini, source = 'profile') {
  if (!mini) return null;
  return toProfile(
    {
      publicId: mini.publicIdentifier,
      urn: mini.entityUrn || mini.objectUrn,
      firstName: mini.firstName,
      lastName: mini.lastName,
      headline: mini.occupation || mini.headline,
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

/** A full `profileView` response → contract `Profile`. */
export function normalizeProfileView(raw, source = 'profile') {
  const included = (raw && raw.included) || [];
  const profile =
    included.find((e) => (e.$type || '').endsWith('identity.profile.Profile')) ||
    included.find((e) => (e.$type || '').includes('Profile')) ||
    {};

  const positions = included
    .filter((e) => (e.$type || '').includes('Position') && !(e.$type || '').includes('Group'))
    .map((p) => ({
      title: p.title || '',
      company: p.companyName || '',
      start: dateToMs(p.timePeriod && p.timePeriod.startDate),
      end: dateToMs(p.timePeriod && p.timePeriod.endDate),
      description: p.description || '',
      companyUrn: p.companyUrn || '',
    }));

  const current = positions.find((p) => !p.end) || positions[0] || {};

  const skills = included
    .filter((e) => (e.$type || '').includes('Skill'))
    .map((s) => s.name)
    .filter(Boolean);

  const education = included
    .filter((e) => (e.$type || '').includes('Education'))
    .map((ed) => ({
      school: ed.schoolName || (ed.school && ed.school.name) || '',
      degree: ed.degreeName || ed.degree || '',
      field: ed.fieldOfStudy || '',
      start: dateToMs(ed.timePeriod && ed.timePeriod.startDate),
      end: dateToMs(ed.timePeriod && ed.timePeriod.endDate),
    }));

  return toProfile(
    {
      publicId: profile.publicIdentifier,
      urn: profile.entityUrn || profile.objectUrn,
      firstName: profile.firstName,
      lastName: profile.lastName,
      headline: profile.headline,
      title: current.title || profile.headline || '',
      company: current.company || '',
      companyUrn: current.companyUrn || '',
      location: profile.locationName || profile.geoLocationName || '',
      industry: profile.industryName || profile.industry || '',
      summary: profile.summary || '',
      photoUrl: vectorImageUrl(profile.picture || profile.profilePicture),
      // A profile read is the one shape that always knows: an unparsable
      // distance here is a real "could not tell", not an absent field, and it
      // must overwrite whatever degree we were holding.
      connectionDegree: degreeOf(profile.distance) ?? null,
      skills,
      experience: positions,
      education,
    },
    source,
  );
}

/**
 * The v1 flat profile shape, kept so the untouched v1 popup and content script
 * keep working. New code should use `normalizeProfileView`.
 */
export function normalizeProfile(raw) {
  const p = normalizeProfileView(raw);
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    fullName: p.fullName,
    headline: p.headline,
    title: p.title,
    company: p.company,
    location: p.location,
    summary: p.summary || '',
    industry: p.industry,
    skills: p.skills,
    education: p.education,
    publicIdentifier: p.publicId,
    linkedinUrl: p.url,
    profileUrn: p.urn,
    connectionDistance: p.connectionDegree ? `DISTANCE_${p.connectionDegree}` : '',
  };
}

/* ------------------------------------------------------------------ */
/*  Search                                                            */
/* ------------------------------------------------------------------ */

function entityResultToProfile(entity, source) {
  const navigationUrl = entity.navigationUrl || '';
  const publicId = publicIdFromUrl(navigationUrl);
  const subtitle = text(entity.primarySubtitle);
  const atIndex = subtitle.lastIndexOf(' at ');
  return toProfile(
    {
      publicId,
      url: publicId ? profileUrl(publicId) : navigationUrl,
      fullName: text(entity.title),
      headline: subtitle,
      title: atIndex > 0 ? subtitle.slice(0, atIndex) : subtitle,
      company: atIndex > 0 ? subtitle.slice(atIndex + 4) : '',
      location: text(entity.secondarySubtitle),
      urn: entity.trackingUrn || entity.entityUrn || '',
      photoUrl: vectorImageUrl(
        entity.image &&
          entity.image.attributes &&
          entity.image.attributes[0] &&
          entity.image.attributes[0].detailData &&
          entity.image.attributes[0].detailData.nonEntityProfilePicture,
      ),
    },
    source,
  );
}

/** A `search/dash/clusters` response → `{ profiles, total }`. */
export function normalizeSearchClusters(raw, source = 'search') {
  const data = (raw && raw.data) || raw || {};
  const clusters = data.elements || raw.elements || [];
  const profiles = [];

  for (const cluster of clusters) {
    for (const item of cluster.items || cluster.results || []) {
      const entity =
        (item.item && item.item.entityResult) || item.entityResult || item.entity || item;
      if (!entity || !entity.navigationUrl) continue;
      const p = entityResultToProfile(entity, source);
      if (p.publicId || p.fullName) profiles.push(p);
    }
  }

  const total =
    (data.metadata && data.metadata.totalResultCount) ||
    (data.paging && data.paging.total) ||
    undefined;
  return { profiles, total };
}

/** The v1 flat search shape, kept for the untouched v1 popup. */
export function normalizeSearchCluster(raw) {
  return normalizeSearchClusters(raw).profiles.map((p) => ({
    fullName: p.fullName,
    headline: p.headline,
    snippet: '',
    publicIdentifier: p.publicId,
    linkedinUrl: p.url,
    entityUrn: p.urn,
    image: p.photoUrl,
  }));
}

/** Sales Navigator people search → `{ profiles, total }`. */
export function normalizeSalesNavSearch(raw) {
  const elements = (raw && raw.elements) || [];
  const profiles = elements.map((e) => {
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

/** Recruiter search → `{ profiles, total }`. */
export function normalizeRecruiterSearch(raw) {
  const elements = (raw && raw.elements) || [];
  const profiles = elements.map((e) => {
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

const PROFILE_WRAPPERS = [
  'connectedMemberResolutionResult',
  'followerProfile',
  'memberProfile',
  'profile',
  'miniProfile',
  'entity',
];

/**
 * Connections, followers, group members and event attendees all come back as
 * `elements` wrapping a profile under one of a handful of field names.
 */
export function normalizeProfileCollection(raw, source = 'network') {
  const elements = (raw && raw.elements) || (raw && raw.data && raw.data.elements) || [];
  const profiles = [];

  for (const element of elements) {
    let person = null;
    for (const key of PROFILE_WRAPPERS) {
      if (element[key]) {
        person = element[key];
        break;
      }
    }
    if (!person && element.publicIdentifier) person = element;
    if (!person) continue;

    const p = miniProfileToProfile(person, source);
    if (!p || !p.publicId) continue;
    if (source === 'connections') p.connectionDegree = 1;
    profiles.push(p);
  }

  const total = raw && raw.paging ? raw.paging.total : undefined;
  return { profiles, total };
}

/* ------------------------------------------------------------------ */
/*  Engagers                                                          */
/* ------------------------------------------------------------------ */

/** `feed/reactions` → `Engager[]`. */
export function normalizeReactions(raw) {
  const elements = (raw && raw.elements) || [];
  const out = [];
  for (const e of elements) {
    const lockup = e.reactorLockup || {};
    const mini =
      (e.reactor && e.reactor['com.linkedin.voyager.feed.MemberActor']) || e.actor || null;
    const base = mini
      ? miniProfileToProfile(mini.miniProfile || mini, 'post-engagers')
      : toProfile(
          {
            publicId: publicIdFromUrl(lockup.navigationUrl),
            fullName: text(lockup.title),
            headline: text(lockup.subtitle),
            urn: e.actorUrn || '',
          },
          'post-engagers',
        );
    if (!base || !base.publicId) continue;
    base.reaction = e.reactionType || 'LIKE';
    base.engagedAt = e.createdAt || undefined;
    out.push(base);
  }
  return out;
}

/** `feed/comments` → `Engager[]`. */
export function normalizeComments(raw) {
  const elements = (raw && raw.elements) || [];
  const out = [];
  for (const e of elements) {
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

function messagingMember(node) {
  if (!node) return null;
  const inner = node['com.linkedin.voyager.messaging.MessagingMember'] || node;
  return inner.miniProfile || inner;
}

function eventText(event) {
  const content = (event && event.eventContent) || {};
  const message = content['com.linkedin.voyager.messaging.event.MessageEvent'] || content;
  return (message.attributedBody && message.attributedBody.text) || message.body || '';
}

export function threadIdFromUrn(urn) {
  const str = String(urn || '');
  const match = str.match(/urn:li:fs_conversation:(.+)$/);
  return match ? match[1] : str;
}

/** `messaging/conversations` → `Thread[]`. */
export function normalizeConversations(raw) {
  const elements = (raw && raw.elements) || [];
  return elements.map((c) => {
    const events = c.events || [];
    const latest = events[0] || {};
    return {
      threadId: threadIdFromUrn(c.entityUrn),
      participants: (c.participants || [])
        .map(messagingMember)
        .filter(Boolean)
        .map((m) => ({
          publicId: m.publicIdentifier || '',
          fullName: `${m.firstName || ''} ${m.lastName || ''}`.trim(),
        })),
      lastMessageAt: c.lastActivityAt || latest.createdAt || 0,
      unread: c.unreadCount ? c.unreadCount > 0 : c.read === false,
      snippet: eventText(latest),
    };
  });
}

/** A conversation's events → `Message[]`, oldest first. */
export function normalizeMessages(raw, threadId) {
  const elements = (raw && raw.elements) || [];
  return elements
    .map((e) => {
      const from = messagingMember(e.from) || {};
      return {
        messageId: e.entityUrn || `${threadId}:${e.createdAt}`,
        threadId,
        fromPublicId: from.publicIdentifier || '',
        body: eventText(e),
        sentAt: e.createdAt || 0,
      };
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

/** `organization/companies` → contract `Company`. */
export function normalizeCompany(raw) {
  const c = (raw && raw.elements && raw.elements[0]) || (raw && raw.data) || raw || {};
  const universalName = c.universalName || '';
  return {
    universalName,
    urn: c.entityUrn || c.objectUrn || '',
    name: c.name || '',
    url: universalName ? `https://www.linkedin.com/company/${universalName}/` : '',
    industry:
      (c.companyIndustries && c.companyIndustries[0] && c.companyIndustries[0].localizedName) ||
      c.industry ||
      '',
    size: sizeLabel(c.staffCountRange, c.staffCount),
    hq: c.headquarter
      ? [c.headquarter.city, c.headquarter.geographicArea, c.headquarter.country]
          .filter(Boolean)
          .join(', ')
      : '',
    website: c.companyPageUrl || c.website || '',
    description: c.description || '',
    followerCount: (c.followingInfo && c.followingInfo.followerCount) || undefined,
    capturedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/*  Activity                                                          */
/* ------------------------------------------------------------------ */

/** A member's recent shares → `{ url, text, likes, comments, postedAt }[]`. */
export function normalizePosts(raw) {
  const elements = (raw && raw.elements) || [];
  return elements
    .map((e) => {
      const counts =
        (e.socialDetail && e.socialDetail.totalSocialActivityCounts) || e.socialCounts || {};
      const activityMatch = String(e.entityUrn || '').match(/urn:li:activity:(\d+)/);
      return {
        url:
          e.permalink ||
          (activityMatch
            ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityMatch[1]}/`
            : ''),
        text: (e.commentary && text(e.commentary.text)) || text(e.commentary) || '',
        likes: counts.numLikes || 0,
        comments: counts.numComments || 0,
        postedAt: e.createdAt || undefined,
      };
    })
    .filter((p) => p.url || p.text);
}

/** The `total` off a zero-count search used to count mutual connections. */
export function normalizeTotal(raw) {
  const data = (raw && raw.data) || {};
  return (
    (data.paging && data.paging.total) ||
    (data.metadata && data.metadata.totalResultCount) ||
    (raw && raw.paging && raw.paging.total) ||
    0
  );
}

/* ------------------------------------------------------------------ */
/*  Invitations                                                       */
/* ------------------------------------------------------------------ */

/**
 * `growth/normInvitations?q=sentInvitationsV2` → the people whose invitation
 * is still outstanding. Voyager has moved this shape around, so the invitee is
 * read from any of the three wrappers it has used.
 */
export function normalizeSentInvitations(raw) {
  const elements = (raw && raw.elements) || (raw && raw.data && raw.data.elements) || [];
  const out = [];

  for (const element of elements) {
    const invitee =
      (element.invitee && element.invitee['com.linkedin.voyager.growth.invitation.InviteeProfile']) ||
      element.invitee ||
      element.inviteeProfile ||
      element.toMember ||
      {};
    const mini = invitee.miniProfile || invitee;
    const publicId = mini.publicIdentifier || publicIdFromUrl(mini.publicProfileUrl);
    if (!publicId) continue;

    out.push({
      publicId,
      invitationUrn: element.entityUrn || element.invitationUrn || '',
      sentAt: element.sentTime || element.createdAt || undefined,
    });
  }

  return out;
}
