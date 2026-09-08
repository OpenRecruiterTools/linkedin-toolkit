/**
 * LinkedIn Voyager API Client
 * Communicates with LinkedIn's internal API using the user's active session.
 * All requests use the JSESSIONID cookie for CSRF and session auth.
 */

const VOYAGER_BASE = 'https://www.linkedin.com/voyager/api';

/* ------------------------------------------------------------------ */
/*  CSRF                                                              */
/* ------------------------------------------------------------------ */

export async function getCsrfToken() {
  const cookie = await chrome.cookies.get({
    url: 'https://www.linkedin.com',
    name: 'JSESSIONID',
  });
  if (!cookie) throw new Error('Not logged in to LinkedIn — JSESSIONID cookie not found.');
  // LinkedIn wraps the value in double-quotes
  return cookie.value.replace(/"/g, '');
}

/* ------------------------------------------------------------------ */
/*  Rate-limit / back-off helpers                                     */
/* ------------------------------------------------------------------ */

/**
 * Check whether a particular action is currently blocked by a backoff timer.
 * @param {string} action  e.g. 'search', 'invite', 'message', 'fetch'
 * @returns {Promise<{blocked: boolean, reason?: string, retryAfter?: number}>}
 */
export async function isActionBlocked(action) {
  const key = `backoff_${action}`;
  const data = await chrome.storage.local.get(key);
  const entry = data[key];
  if (!entry) return { blocked: false };
  if (Date.now() >= entry.until) {
    await chrome.storage.local.remove(key);
    return { blocked: false };
  }
  return {
    blocked: true,
    reason: entry.reason,
    retryAfter: entry.until - Date.now(),
  };
}

/**
 * Block an action for a given number of milliseconds.
 */
export async function blockAction(action, ms, reason) {
  const key = `backoff_${action}`;
  await chrome.storage.local.set({
    [key]: { until: Date.now() + ms, reason },
  });
}

/**
 * Map known LinkedIn error codes / HTTP statuses to backoff durations.
 */
export function backoffFor(errCode) {
  const map = {
    429: 15 * 60 * 1000,       // 15 min
    401: 0,                    // re-auth needed, no point waiting
    403: 5 * 60 * 1000,        // 5 min
    451: 60 * 60 * 1000,       // security challenge — 1 hour
    RATE_LIMITED: 15 * 60 * 1000,
    SECURITY_CHALLENGE: 60 * 60 * 1000,
  };
  return map[errCode] || 60 * 1000; // default 1 min
}

/* ------------------------------------------------------------------ */
/*  Core fetch wrapper                                                */
/* ------------------------------------------------------------------ */

/**
 * Make an authenticated request to LinkedIn's Voyager API.
 * Handles CSRF headers, rate-limit detection, and common error codes.
 *
 * @param {string}  path     e.g. '/identity/profiles/johndoe/profileView'
 * @param {object}  options  fetch options (method, body, headers, etc.)
 * @returns {Promise<any>}   parsed JSON response
 */
export async function voyagerFetch(path, options = {}) {
  // Check global fetch backoff
  const status = await isActionBlocked('fetch');
  if (status.blocked) {
    throw new Error(`LinkedIn requests paused: ${status.reason}. Retry in ${Math.round(status.retryAfter / 1000)}s.`);
  }

  const csrf = await getCsrfToken();

  const url = path.startsWith('http') ? path : `${VOYAGER_BASE}${path}`;

  const headers = {
    'csrf-token': csrf,
    'x-restli-protocol-version': '2.0.0',
    accept: 'application/vnd.linkedin.normalized+json+2.1',
    ...(options.headers || {}),
  };

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const resp = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // ---------- Error handling ----------

  if (resp.status === 429) {
    const wait = backoffFor(429);
    await blockAction('fetch', wait, 'Rate limited by LinkedIn (429)');
    throw new Error('Rate limited by LinkedIn. Pausing requests for 15 minutes.');
  }

  if (resp.status === 401 || resp.status === 403) {
    const wait = backoffFor(resp.status);
    if (wait > 0) await blockAction('fetch', wait, `Auth error (${resp.status})`);
    throw new Error(
      resp.status === 401
        ? 'LinkedIn session expired. Please log in again.'
        : 'LinkedIn denied access (403). Your session may be flagged.'
    );
  }

  if (resp.status === 451) {
    const wait = backoffFor(451);
    await blockAction('fetch', wait, 'Security challenge triggered');
    throw new Error('LinkedIn security challenge detected. Open LinkedIn in your browser and complete it.');
  }

  if (!resp.ok) {
    let errorBody = '';
    try {
      errorBody = await resp.text();
    } catch (_) { /* ignore */ }

    // Try to extract LinkedIn's error code
    let errCode;
    try {
      const parsed = JSON.parse(errorBody);
      errCode = parsed.errorCode || parsed.code || parsed.status;
    } catch (_) { /* ignore */ }

    if (errCode) {
      const wait = backoffFor(errCode);
      if (wait > 0) await blockAction('fetch', wait, `LinkedIn error: ${errCode}`);
    }

    throw new Error(`Voyager API error ${resp.status}: ${errorBody.slice(0, 500)}`);
  }

  // Some endpoints return 204 No Content
  if (resp.status === 204) return { ok: true };

  const text = await resp.text();
  if (!text) return { ok: true };

  return JSON.parse(text);
}

/* ------------------------------------------------------------------ */
/*  Profile                                                           */
/* ------------------------------------------------------------------ */

/**
 * Fetch a full profile view for a given public identifier (vanity URL slug).
 */
export async function getProfile(publicIdentifier) {
  const check = await isActionBlocked('profile');
  if (check.blocked) throw new Error(`Profile fetch paused: ${check.reason}`);

  return voyagerFetch(
    `/identity/profiles/${encodeURIComponent(publicIdentifier)}/profileView`
  );
}

/**
 * Extract a clean, flat profile object from the raw Voyager profileView response.
 */
export function normalizeProfile(raw) {
  const included = raw.included || [];

  // Find the main profile entity
  const profile = included.find(
    (e) => e.$type === 'com.linkedin.voyager.identity.profile.Profile'
  ) || included.find(
    (e) => e.$type === 'com.linkedin.voyager.dash.identity.profile.Profile'
  ) || {};

  // Find positions (experience)
  const positions = included.filter(
    (e) =>
      (e.$type || '').includes('Position') &&
      !(e.$type || '').includes('Group')
  );

  // Current position
  const current = positions.find((p) => !p.timePeriod?.endDate) || positions[0];

  // Skills
  const skills = included
    .filter((e) => (e.$type || '').includes('Skill'))
    .map((s) => s.name)
    .filter(Boolean);

  // Education
  const education = included
    .filter((e) => (e.$type || '').includes('Education'))
    .map((ed) => ({
      school: ed.schoolName || ed.school?.name || '',
      degree: ed.degreeName || ed.degree || '',
      field: ed.fieldOfStudy || '',
    }));

  const firstName = profile.firstName || '';
  const lastName = profile.lastName || '';
  const publicIdentifier = profile.publicIdentifier || profile.miniProfile?.publicIdentifier || '';

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    headline: profile.headline || '',
    title: current?.title || profile.headline || '',
    company: current?.companyName || '',
    location: profile.locationName || profile.geoLocationName || '',
    summary: profile.summary || '',
    industry: profile.industryName || profile.industry || '',
    skills,
    education,
    publicIdentifier,
    linkedinUrl: publicIdentifier
      ? `https://www.linkedin.com/in/${publicIdentifier}/`
      : '',
    profileUrn: profile.entityUrn || profile.objectUrn || '',
    connectionDistance: profile.distance?.value || '',
  };
}

/* ------------------------------------------------------------------ */
/*  Search                                                            */
/* ------------------------------------------------------------------ */

/**
 * Search for people on LinkedIn.
 * @param {object} params
 * @param {string} params.keywords  search query
 * @param {number} [params.start=0]   pagination offset
 * @param {number} [params.count=25]  results per page
 * @returns {Promise<object>}  raw search response
 */
export async function searchPeople({ keywords, start = 0, count = 25 }) {
  const check = await isActionBlocked('search');
  if (check.blocked) throw new Error(`Search paused: ${check.reason}`);

  // Modern nested query format used by current LinkedIn UI
  const queryParams = new URLSearchParams({
    decorationId: 'com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186',
    origin: 'GLOBAL_SEARCH_HEADER',
    q: 'all',
    query: `(keywords:${encodeURIComponent(keywords)},resultType:(value:PEOPLE))`,
    start: String(start),
    count: String(count),
  });

  try {
    return await voyagerFetch(`/search/dash/clusters?${queryParams.toString()}`);
  } catch (err) {
    // Fallback to flat params if nested format returns 400
    if (err.message.includes('400')) {
      const fallbackParams = new URLSearchParams({
        decorationId: 'com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186',
        origin: 'GLOBAL_SEARCH_HEADER',
        q: 'all',
        keywords,
        resultType: 'PEOPLE',
        start: String(start),
        count: String(count),
      });
      return voyagerFetch(`/search/dash/clusters?${fallbackParams.toString()}`);
    }
    throw err;
  }
}

/**
 * Extract a flat array of candidate objects from the raw search cluster response.
 */
export function normalizeSearchCluster(raw) {
  const results = [];
  const included = raw.included || [];
  const elements = raw.data?.elements || raw.elements || [];

  // Search results are nested inside cluster elements
  for (const cluster of elements) {
    const items = cluster.items || cluster.results || [];
    for (const item of items) {
      const entity =
        item.item?.entityResult ||
        item.entityResult ||
        item.entity ||
        item;

      if (!entity) continue;

      const title = entity.title?.text || entity.title || '';
      const subtitle = entity.primarySubtitle?.text || entity.subtitle || '';
      const summary = entity.summary?.text || entity.snippetText || '';
      const navigationUrl = entity.navigationUrl || '';

      // Extract public identifier from navigation URL
      let publicIdentifier = '';
      const match = navigationUrl.match(/linkedin\.com\/in\/([^/?]+)/);
      if (match) publicIdentifier = decodeURIComponent(match[1]);

      const image =
        entity.image?.attributes?.[0]?.detailData?.nonEntityProfilePicture
          ?.vectorImage?.artifacts?.[0]?.fileIdentifyingUrlPathSegment || '';

      if (title || publicIdentifier) {
        results.push({
          fullName: title,
          headline: subtitle,
          snippet: summary,
          publicIdentifier,
          linkedinUrl: publicIdentifier
            ? `https://www.linkedin.com/in/${publicIdentifier}/`
            : navigationUrl,
          entityUrn: entity.entityUrn || entity.objectUrn || '',
          image,
        });
      }
    }
  }

  // Fallback: scan included array for mini profiles if elements were sparse
  if (results.length === 0) {
    for (const inc of included) {
      if (
        inc.$type &&
        (inc.$type.includes('MiniProfile') || inc.$type.includes('SearchProfile'))
      ) {
        const pi = inc.publicIdentifier || '';
        results.push({
          fullName: `${inc.firstName || ''} ${inc.lastName || ''}`.trim(),
          headline: inc.occupation || inc.headline || '',
          snippet: '',
          publicIdentifier: pi,
          linkedinUrl: pi ? `https://www.linkedin.com/in/${pi}/` : '',
          entityUrn: inc.entityUrn || inc.objectUrn || '',
          image: '',
        });
      }
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Invitations                                                       */
/* ------------------------------------------------------------------ */

/**
 * Send a connection invitation.
 * @param {object} params
 * @param {string} params.publicIdentifier
 * @param {string} [params.profileUrn]   e.g. 'urn:li:fsd_profile:ABC123'
 * @param {string} [params.note]         optional note (max 300 chars)
 */
export async function sendInvite({ publicIdentifier, profileUrn, note }) {
  const check = await isActionBlocked('invite');
  if (check.blocked) throw new Error(`Invites paused: ${check.reason}`);

  // Resolve profile URN if not provided
  if (!profileUrn && publicIdentifier) {
    const profileData = await getProfile(publicIdentifier);
    const included = profileData.included || [];
    const prof = included.find(
      (e) => (e.$type || '').includes('Profile') && e.publicIdentifier === publicIdentifier
    );
    profileUrn = prof?.entityUrn || prof?.objectUrn || '';
  }

  if (!profileUrn) {
    throw new Error('Could not resolve profile URN for invitation.');
  }

  // Normalize URN format
  const inviteeUrn = profileUrn.includes('fsd_profile')
    ? profileUrn
    : profileUrn.replace('fs_miniProfile', 'fsd_profile').replace('fs_profile', 'fsd_profile');

  const body = {
    inviteeProfileUrn: inviteeUrn,
    trackingId: generateTrackingId(),
  };

  if (note) {
    body.message = note.slice(0, 300);
  }

  return voyagerFetch('/growth/normInvitations', {
    method: 'POST',
    body,
  });
}

/* ------------------------------------------------------------------ */
/*  Messaging                                                         */
/* ------------------------------------------------------------------ */

/**
 * Send a message to a LinkedIn user.
 * @param {object} params
 * @param {string} params.recipientUrn     e.g. 'urn:li:fsd_profile:ABC123'
 * @param {string} params.body             message text
 * @param {string} [params.subtype]        'MEMBER_TO_MEMBER' (default) or 'INMAIL'
 * @param {string} [params.inmailSubject]  subject for InMail
 */
export async function sendMessage({ recipientUrn, body, subtype = 'MEMBER_TO_MEMBER', inmailSubject }) {
  const check = await isActionBlocked('message');
  if (check.blocked) throw new Error(`Messages paused: ${check.reason}`);

  if (!recipientUrn) throw new Error('recipientUrn is required to send a message.');
  if (!body) throw new Error('Message body cannot be empty.');

  const payload = {
    keyVersion: 'LEGACY_INBOX',
    conversationCreate: {
      eventCreate: {
        value: {
          'com.linkedin.voyager.messaging.create.MessageCreate': {
            attributedBody: {
              text: body,
              attributes: [],
            },
            attachments: [],
          },
        },
      },
      recipients: [recipientUrn],
      subtype: subtype === 'INMAIL' ? 'INMAIL' : 'MEMBER_TO_MEMBER',
    },
  };

  if (subtype === 'INMAIL' && inmailSubject) {
    payload.conversationCreate.eventCreate.value[
      'com.linkedin.voyager.messaging.create.MessageCreate'
    ].subject = inmailSubject;
  }

  return voyagerFetch('/messaging/conversations?action=create', {
    method: 'POST',
    body: payload,
  });
}

/* ------------------------------------------------------------------ */
/*  Connection status                                                 */
/* ------------------------------------------------------------------ */

/**
 * Check whether the logged-in user is already connected to a profile.
 * @returns {Promise<{connected: boolean, distance: string}>}
 */
export async function getConnectionStatus(publicIdentifier) {
  const raw = await getProfile(publicIdentifier);
  const normalized = normalizeProfile(raw);
  const distance = normalized.connectionDistance || '';
  return {
    connected: distance === 'DISTANCE_1',
    distance,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function generateTrackingId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
