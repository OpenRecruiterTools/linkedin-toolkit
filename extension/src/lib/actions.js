/**
 * LinkedIn Toolkit — shared action contract.
 *
 * Source of truth: `docs/actions.md`. Every layer (engine, popup, bridge, MCP
 * server, CLI, clients) speaks exactly these action names, error codes and
 * event names. Nothing here may be invented without adding it to that file.
 *
 * No dependencies, no build step: this file is loaded directly by the MV3
 * service worker.
 */

/* ================================================================== */
/*  Action names                                                      */
/* ================================================================== */

export const ACTIONS = Object.freeze({
  STATUS_GET: 'status.get',

  CONFIG_GET: 'config.get',
  CONFIG_SET: 'config.set',

  SEARCH_PEOPLE: 'search.people',

  PROFILE_GET: 'profile.get',
  PROFILE_EXPORT: 'profile.export',

  COMPANY_GET: 'company.get',
  COMPANY_EMPLOYEES: 'company.employees',

  POST_ENGAGERS: 'post.engagers',
  GROUP_MEMBERS: 'group.members',
  EVENT_ATTENDEES: 'event.attendees',

  NETWORK_CONNECTIONS: 'network.connections',
  NETWORK_FOLLOWERS: 'network.followers',
  NETWORK_STATUS: 'network.status',
  NETWORK_UNFOLLOW_COUNT: 'network.unfollowCount',
  NETWORK_UNFOLLOW_ALL: 'network.unfollowAll',

  OUTREACH_VIEW: 'outreach.view',
  OUTREACH_FOLLOW: 'outreach.follow',
  OUTREACH_INVITE: 'outreach.invite',
  OUTREACH_MESSAGE: 'outreach.message',
  OUTREACH_INMAIL: 'outreach.inmail',
  OUTREACH_LIKE: 'outreach.like',
  OUTREACH_COMMENT: 'outreach.comment',

  INBOX_THREADS: 'inbox.threads',
  INBOX_MESSAGES: 'inbox.messages',
  INBOX_EXPORT: 'inbox.export',

  LIST_CREATE: 'list.create',
  LIST_GET_ALL: 'list.getAll',
  LIST_GET: 'list.get',
  LIST_ADD: 'list.add',
  LIST_REMOVE: 'list.remove',
  LIST_MEMBERS: 'list.members',
  LIST_DELETE: 'list.delete',
  LIST_IMPORT_CSV: 'list.importCsv',

  CAMPAIGN_CREATE: 'campaign.create',
  CAMPAIGN_GET_ALL: 'campaign.getAll',
  CAMPAIGN_GET: 'campaign.get',
  CAMPAIGN_ENROLL: 'campaign.enroll',
  CAMPAIGN_PAUSE: 'campaign.pause',
  CAMPAIGN_RESUME: 'campaign.resume',
  CAMPAIGN_DELETE: 'campaign.delete',
  CAMPAIGN_TICK: 'campaign.tick',

  QUEUE_LIST: 'queue.list',
  QUEUE_APPROVE: 'queue.approve',
  QUEUE_REJECT: 'queue.reject',

  AI_COMPLETE: 'ai.complete',

  EXPORT_CSV: 'export.csv',

  RESEARCH_RESOLVE: 'research.resolve',
  RESEARCH_PACK: 'research.pack',
  RESEARCH_GET: 'research.get',

  SYNC_PULL: 'sync.pull',
});

/* ================================================================== */
/*  Error codes                                                       */
/* ================================================================== */

export const ERROR = Object.freeze({
  EXTENSION_OFFLINE: 'EXTENSION_OFFLINE',
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  RATE_LIMITED: 'RATE_LIMITED',
  CHALLENGE_DETECTED: 'CHALLENGE_DETECTED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  OUTSIDE_BUSINESS_HOURS: 'OUTSIDE_BUSINESS_HOURS',
  INVALID_PARAMS: 'INVALID_PARAMS',
  NOT_FOUND: 'NOT_FOUND',
  LINKEDIN_ERROR: 'LINKEDIN_ERROR',
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  AI_ERROR: 'AI_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL: 'INTERNAL',
});

/* ================================================================== */
/*  Event names                                                       */
/* ================================================================== */

export const EVENTS = Object.freeze({
  INVITE_ACCEPTED: 'invite_accepted',
  REPLY_RECEIVED: 'reply_received',
  POSITIVE_REPLY: 'positive_reply',
  CAMPAIGN_STEP_DONE: 'campaign_step_done',
  CAMPAIGN_COMPLETED: 'campaign_completed',
  QUOTA_HIT: 'quota_hit',
  CHALLENGE_DETECTED: 'challenge_detected',
  QUEUE_ITEM_ADDED: 'queue_item_added',
  QUEUE_ITEM_SENT: 'queue_item_sent',
  CAMPAIGN_NOTE_TRUNCATED: 'campaign_note_truncated',
  RESEARCH_PROGRESS: 'research_progress',
  RESEARCH_COMPLETED: 'research_completed',
});

/* ================================================================== */
/*  Hard caps — enforced in the extension, unraisable by any client    */
/* ================================================================== */

export const HARD_CAPS = Object.freeze({
  dailyInviteCap: 100,
  dailyMessageCap: 150,
  dailyVisitCap: 500,
  dailySearchCap: 1000,
});

/**
 * How long an invitation note may be.
 *
 * LinkedIn's own dialog stops at 200 characters (captured 2026-09-09, web
 * client 1.13.46516). The engine is the only place that number is written, so
 * validation, the queue, the campaign renderer and the Voyager write all agree.
 */
export const INVITE_NOTE_MAX = 200;

/** The one sentence every layer says when a note is too long. */
export const INVITE_NOTE_FIX = 'LinkedIn limits invitation notes to 200 characters.';

/* ------------------------------------------------------------------ */
/*  Mass unfollow                                                      */
/* ------------------------------------------------------------------ */

/**
 * How many accounts one `network.unfollowAll` run may touch.
 *
 * The floor is 1 because the whole point of the limit is that you can try the
 * thing on one person before you trust it with your whole list. The ceiling is
 * a sanity bound, not a safety one: a run of 5,000 already takes most of a day
 * at human pace, and anything larger is a typo rather than an intention.
 */
export const UNFOLLOW_LIMIT_MIN = 1;
export const UNFOLLOW_LIMIT_MAX = 5000;

/** What the popup puts in the box before you touch it. */
export const UNFOLLOW_LIMIT_DEFAULT = 25;

/** The one sentence every layer says when the limit is out of range. */
export const UNFOLLOW_LIMIT_FIX =
  `limit must be between ${UNFOLLOW_LIMIT_MIN} and ${UNFOLLOW_LIMIT_MAX}; ` +
  'leave it out to walk the whole list.';

/** How many names `network.unfollowCount` returns as a sample. */
export const UNFOLLOW_SAMPLE_MAX = 10;

/** Floors and ceilings that are not part of HARD_CAPS but are still enforced. */
const MIN_DELAY_MS = 3000;
const MAX_HOURLY_CAP = 50;

export const DEFAULT_CONFIG = {
  minDelayMs: 8000,
  maxDelayMs: 15000,
  hourlyCap: 20,
  dailyInviteCap: 25,
  dailyMessageCap: 50,
  dailyVisitCap: 100,
  dailySearchCap: 500,
  businessHoursOnly: true,
  businessStart: 9,
  businessEnd: 18,
  weekdaysOnly: true,
  autopilot: false,
  accountPreset: 'free',
  warmup: { enabled: false, days: 14 },
  ai: { provider: 'none' },
  enrichment: { provider: 'none' },
  bridge: { enabled: false, port: 47829 },
};

const ACCOUNT_PRESETS = ['free', 'premium', 'salesnav', 'recruiter'];
const AI_PROVIDERS = ['none', 'anthropic', 'openai', 'gemini', 'ollama', 'openai-compatible'];
const ENRICHMENT_PROVIDERS = ['none', 'hunter'];

/* ================================================================== */
/*  Errors and envelopes                                              */
/* ================================================================== */

export class EngineError extends Error {
  /**
   * @param {string} code one of ERROR
   * @param {string} message human-readable
   * @param {object} [extra] extra error fields (retryAfter, howToFix, …)
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.extra = extra || {};
  }
}

/** Success envelope. `rateLimit` is omitted entirely when not supplied. */
export function ok(id, data, rateLimit) {
  const envelope = { id, ok: true, data };
  if (rateLimit !== undefined && rateLimit !== null) envelope.rateLimit = rateLimit;
  return envelope;
}

/** Error envelope. `extra` is folded into `error` (retryAfter, howToFix, …). */
export function err(id, code, message, extra) {
  return { id, ok: false, error: { code, message, ...(extra || {}) } };
}

/* ================================================================== */
/*  Param validation                                                  */
/* ================================================================== */

/**
 * Declarative per-action parameter specs.
 *
 *   required : { field: 'string'|'number'|'boolean'|'array'|'object' }
 *   optional : same shape
 *   enums    : { field: [allowed, …] }
 *   min      : { field: floor }    (numeric, inclusive)
 *   max      : { field: ceiling }  (numeric, inclusive)
 *   maxLength: { field: ceiling }  (string length, inclusive)
 *   fix      : { field: howToFix } (advice attached when that field is refused)
 *   anyOf    : [field, …]          (at least one must be present)
 */
const PARAM_SPECS = {
  [ACTIONS.STATUS_GET]: {
    // `verify` runs the endpoint self-check; `postUrl` opts the reactions
    // endpoint into it. Both are optional, and both have to be declared here
    // or a caller asking for them gets a plain Status and no explanation.
    optional: { verify: 'boolean', postUrl: 'string' },
  },

  [ACTIONS.CONFIG_GET]: {},
  [ACTIONS.CONFIG_SET]: {},

  [ACTIONS.SEARCH_PEOPLE]: {
    required: { keywords: 'string' },
    optional: {
      title: 'string',
      company: 'string',
      location: 'string',
      source: 'string',
      start: 'number',
      count: 'number',
    },
    enums: { source: ['search', 'salesnav', 'recruiter'] },
    max: { count: 100 },
  },

  [ACTIONS.PROFILE_GET]: {
    optional: { url: 'string', publicId: 'string', full: 'boolean' },
    anyOf: ['url', 'publicId'],
  },
  [ACTIONS.PROFILE_EXPORT]: {
    required: { urls: 'array' },
    optional: { full: 'boolean' },
  },

  [ACTIONS.COMPANY_GET]: {
    optional: { url: 'string', universalName: 'string' },
    anyOf: ['url', 'universalName'],
  },
  [ACTIONS.COMPANY_EMPLOYEES]: {
    required: { universalName: 'string' },
    optional: { start: 'number', count: 'number' },
  },

  [ACTIONS.POST_ENGAGERS]: {
    required: { postUrl: 'string', kind: 'string' },
    optional: { start: 'number', count: 'number' },
    enums: { kind: ['likes', 'comments', 'both'] },
  },
  [ACTIONS.GROUP_MEMBERS]: {
    required: { groupUrl: 'string' },
    optional: { start: 'number', count: 'number' },
  },
  [ACTIONS.EVENT_ATTENDEES]: {
    required: { eventUrl: 'string' },
    optional: { start: 'number', count: 'number' },
  },

  [ACTIONS.NETWORK_CONNECTIONS]: { optional: { start: 'number', count: 'number' } },
  [ACTIONS.NETWORK_FOLLOWERS]: { optional: { start: 'number', count: 'number' } },
  [ACTIONS.NETWORK_STATUS]: { required: { publicIds: 'array' } },
  [ACTIONS.NETWORK_UNFOLLOW_COUNT]: {},
  // `limit` is the safety rail: run it on one person first, then five, and
  // only then trust it with everything. `dryRun` walks the same list and
  // clicks nothing, so the names can be read before anything is undoable.
  [ACTIONS.NETWORK_UNFOLLOW_ALL]: {
    optional: { limit: 'number', dryRun: 'boolean' },
    min: { limit: UNFOLLOW_LIMIT_MIN },
    max: { limit: UNFOLLOW_LIMIT_MAX },
    fix: { limit: UNFOLLOW_LIMIT_FIX },
  },

  [ACTIONS.OUTREACH_VIEW]: { required: { publicId: 'string' } },
  [ACTIONS.OUTREACH_FOLLOW]: { required: { publicId: 'string' } },
  [ACTIONS.OUTREACH_INVITE]: {
    required: { publicId: 'string' },
    optional: { note: 'string', dryRun: 'boolean' },
    // Refusing an over-long note here means the caller is told before a quota
    // unit is spent and before LinkedIn is asked to do anything.
    maxLength: { note: INVITE_NOTE_MAX },
    fix: { note: INVITE_NOTE_FIX },
  },
  [ACTIONS.OUTREACH_MESSAGE]: {
    required: { publicId: 'string', body: 'string' },
    optional: { dryRun: 'boolean' },
  },
  [ACTIONS.OUTREACH_INMAIL]: {
    required: { publicId: 'string', subject: 'string', body: 'string' },
    optional: { dryRun: 'boolean' },
  },
  [ACTIONS.OUTREACH_LIKE]: {
    required: { postUrl: 'string' },
    optional: { dryRun: 'boolean' },
  },
  [ACTIONS.OUTREACH_COMMENT]: {
    required: { postUrl: 'string', body: 'string' },
    optional: { dryRun: 'boolean' },
  },

  [ACTIONS.INBOX_THREADS]: {
    optional: { since: 'number', unreadOnly: 'boolean', count: 'number' },
  },
  [ACTIONS.INBOX_MESSAGES]: {
    required: { threadId: 'string' },
    optional: { since: 'number' },
  },
  [ACTIONS.INBOX_EXPORT]: { optional: { since: 'number' } },

  [ACTIONS.LIST_CREATE]: {
    required: { name: 'string' },
    optional: { tags: 'array' },
  },
  [ACTIONS.LIST_GET_ALL]: {},
  [ACTIONS.LIST_GET]: { required: { listId: 'string' } },
  [ACTIONS.LIST_ADD]: {
    required: { listId: 'string' },
    optional: { profiles: 'array', publicIds: 'array' },
    anyOf: ['profiles', 'publicIds'],
  },
  [ACTIONS.LIST_REMOVE]: { required: { listId: 'string', publicIds: 'array' } },
  [ACTIONS.LIST_MEMBERS]: {
    required: { listId: 'string' },
    optional: { start: 'number', count: 'number' },
  },
  [ACTIONS.LIST_DELETE]: { required: { listId: 'string' } },
  [ACTIONS.LIST_IMPORT_CSV]: { required: { listId: 'string', csv: 'string' } },

  [ACTIONS.CAMPAIGN_CREATE]: {
    required: { name: 'string', steps: 'array' },
    optional: { listId: 'string', publicIds: 'array', settings: 'object' },
  },
  [ACTIONS.CAMPAIGN_GET_ALL]: {},
  [ACTIONS.CAMPAIGN_GET]: { required: { campaignId: 'string' } },
  [ACTIONS.CAMPAIGN_ENROLL]: { required: { campaignId: 'string', publicIds: 'array' } },
  [ACTIONS.CAMPAIGN_PAUSE]: { required: { campaignId: 'string' } },
  [ACTIONS.CAMPAIGN_RESUME]: { required: { campaignId: 'string' } },
  [ACTIONS.CAMPAIGN_DELETE]: { required: { campaignId: 'string' } },
  [ACTIONS.CAMPAIGN_TICK]: {},

  [ACTIONS.QUEUE_LIST]: {
    optional: { status: 'string' },
    // `failed` is a status the queue actually writes, so it has to be a status
    // the queue can be asked for; without it there was no way to list the
    // items that did not send.
    enums: { status: ['pending', 'approved', 'rejected', 'sent', 'failed'] },
  },
  [ACTIONS.QUEUE_APPROVE]: {
    required: { ids: 'array' },
    optional: { edits: 'object' },
  },
  [ACTIONS.QUEUE_REJECT]: { required: { ids: 'array' } },

  [ACTIONS.AI_COMPLETE]: {
    required: { task: 'string', input: 'object' },
    enums: { task: ['opener', 'summary', 'sentiment', 'comment', 'score'] },
  },

  [ACTIONS.EXPORT_CSV]: {
    required: { kind: 'string' },
    optional: { id: 'string' },
    enums: { kind: ['profiles', 'list', 'campaign', 'inbox'] },
  },

  [ACTIONS.RESEARCH_RESOLVE]: { required: { rows: 'array' } },
  [ACTIONS.RESEARCH_PACK]: {
    required: { rows: 'array' },
    optional: { listName: 'string', enrich: 'boolean', full: 'boolean' },
  },
  [ACTIONS.RESEARCH_GET]: { required: { jobId: 'string' } },

  [ACTIONS.SYNC_PULL]: { optional: { since: 'number' } },
};

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function checkType(field, value, expected) {
  const actual = typeOf(value);
  if (expected === 'object') {
    if (actual !== 'object') return `${field} must be an object`;
    return null;
  }
  if (actual !== expected) return `${field} must be a ${expected}`;
  return null;
}

/**
 * Validate params for an action.
 * @returns {{ok: true} | {ok: false, message: string, howToFix?: string}}
 */
export function validateParams(action, params = {}) {
  const spec = Object.prototype.hasOwnProperty.call(PARAM_SPECS, action)
    ? PARAM_SPECS[action]
    : null;
  if (!spec) return { ok: false, message: 'unknown action' };

  const p = params && typeof params === 'object' && !Array.isArray(params) ? params : null;
  if (!p) return { ok: false, message: 'params must be an object' };

  const required = spec.required || {};
  const optional = spec.optional || {};
  const enums = spec.enums || {};
  const min = spec.min || {};
  const max = spec.max || {};
  const maxLength = spec.maxLength || {};
  const fix = spec.fix || {};

  /** A refusal, with the per-field advice when the spec carries any. */
  const refuse = (field, message) =>
    fix[field] ? { ok: false, message, howToFix: fix[field] } : { ok: false, message };

  for (const [field, expected] of Object.entries(required)) {
    if (p[field] === undefined || p[field] === null) {
      return { ok: false, message: `${field} is required` };
    }
    const problem = checkType(field, p[field], expected);
    if (problem) return { ok: false, message: problem };
    if (expected === 'string' && p[field] === '') {
      return { ok: false, message: `${field} must not be empty` };
    }
  }

  for (const [field, expected] of Object.entries(optional)) {
    if (p[field] === undefined || p[field] === null) continue;
    const problem = checkType(field, p[field], expected);
    if (problem) return { ok: false, message: problem };
  }

  for (const [field, allowed] of Object.entries(enums)) {
    if (p[field] === undefined || p[field] === null) continue;
    if (!allowed.includes(p[field])) {
      return { ok: false, message: `${field} must be one of: ${allowed.join(', ')}` };
    }
  }

  for (const [field, floor] of Object.entries(min)) {
    if (p[field] === undefined || p[field] === null) continue;
    if (p[field] < floor) {
      return refuse(field, `${field} must be ${floor} or more`);
    }
  }

  for (const [field, ceiling] of Object.entries(max)) {
    if (p[field] === undefined || p[field] === null) continue;
    if (p[field] > ceiling) {
      return refuse(field, `${field} must be ${ceiling} or less`);
    }
  }

  for (const [field, ceiling] of Object.entries(maxLength)) {
    if (p[field] === undefined || p[field] === null) continue;
    const length = String(p[field]).length;
    if (length > ceiling) {
      return refuse(
        field,
        `${field} must be ${ceiling} characters or fewer (this one is ${length})`,
      );
    }
  }

  if (spec.anyOf && !spec.anyOf.some((f) => p[f] !== undefined && p[f] !== null)) {
    return { ok: false, message: `one of ${spec.anyOf.join(' or ')} is required` };
  }

  return { ok: true };
}

/* ================================================================== */
/*  Config clamping                                                   */
/* ================================================================== */

function toNumber(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function clampInt(value, fallback, min, maxValue) {
  let n = Math.round(toNumber(value, fallback));
  if (typeof min === 'number' && n < min) n = min;
  if (typeof maxValue === 'number' && n > maxValue) n = maxValue;
  return n;
}

/**
 * Merge a partial config over DEFAULT_CONFIG, coerce types and enforce the
 * hard ceilings. Always returns a fresh object; never mutates its input or
 * DEFAULT_CONFIG.
 */
export function clampConfig(cfg = {}) {
  const input = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  const d = DEFAULT_CONFIG;

  const minDelayMs = clampInt(input.minDelayMs, d.minDelayMs, MIN_DELAY_MS);
  const maxDelayMs = clampInt(input.maxDelayMs, d.maxDelayMs, minDelayMs);

  const out = {
    minDelayMs,
    maxDelayMs,
    hourlyCap: clampInt(input.hourlyCap, d.hourlyCap, 0, MAX_HOURLY_CAP),
    dailyInviteCap: clampInt(input.dailyInviteCap, d.dailyInviteCap, 0, HARD_CAPS.dailyInviteCap),
    dailyMessageCap: clampInt(
      input.dailyMessageCap,
      d.dailyMessageCap,
      0,
      HARD_CAPS.dailyMessageCap,
    ),
    dailyVisitCap: clampInt(input.dailyVisitCap, d.dailyVisitCap, 0, HARD_CAPS.dailyVisitCap),
    dailySearchCap: clampInt(input.dailySearchCap, d.dailySearchCap, 0, HARD_CAPS.dailySearchCap),
    businessHoursOnly: toBoolean(input.businessHoursOnly, d.businessHoursOnly),
    businessStart: clampInt(input.businessStart, d.businessStart, 0, 23),
    businessEnd: clampInt(input.businessEnd, d.businessEnd, 0, 24),
    weekdaysOnly: toBoolean(input.weekdaysOnly, d.weekdaysOnly),
    autopilot: toBoolean(input.autopilot, d.autopilot),
    accountPreset: ACCOUNT_PRESETS.includes(input.accountPreset)
      ? input.accountPreset
      : d.accountPreset,
    warmup: { ...d.warmup, ...(input.warmup || {}) },
    ai: { ...d.ai, ...(input.ai || {}) },
    enrichment: { ...d.enrichment, ...(input.enrichment || {}) },
    bridge: { ...d.bridge, ...(input.bridge || {}) },
  };

  out.warmup.enabled = toBoolean(out.warmup.enabled, d.warmup.enabled);
  out.warmup.days = clampInt(out.warmup.days, d.warmup.days, 0);
  if (out.warmup.startedAt !== undefined) {
    out.warmup.startedAt = clampInt(out.warmup.startedAt, 0, 0);
  }

  if (!AI_PROVIDERS.includes(out.ai.provider)) out.ai.provider = d.ai.provider;
  if (!ENRICHMENT_PROVIDERS.includes(out.enrichment.provider)) {
    out.enrichment.provider = d.enrichment.provider;
  }

  out.bridge.enabled = toBoolean(out.bridge.enabled, d.bridge.enabled);
  out.bridge.port = clampInt(out.bridge.port, d.bridge.port, 1, 65535);

  if (input.webhookUrl !== undefined) out.webhookUrl = input.webhookUrl;

  return out;
}
