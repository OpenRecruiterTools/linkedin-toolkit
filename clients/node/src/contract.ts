/* eslint-disable */
/**
 * AUTO-GENERATED — do not edit by hand.
 *
 * Written by `npm run gen` in `clients/node`. Source of truth:
 * `mcp-server/src/contract.ts`. The only change is that the `RESULTS`
 * annotation is dropped so per-action result types survive `z.infer`;
 * `ResultsCoverEveryAction` at the end of the file proves nothing was lost.
 */
/**
 * The contract: a zod mirror of `docs/actions.md`.
 *
 * Everything else in this package is generated from or validated against this file:
 * the MCP tool list, the OpenAPI document, the `/actions/{action}` router and the CLI.
 * Action names, error codes, event names and shapes must match `docs/actions.md` exactly.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Shared types
 * ------------------------------------------------------------------ */

export const ExperienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  start: z.string().optional(),
  end: z.string().optional(),
  description: z.string().optional(),
});

export const EducationSchema = z.object({
  school: z.string(),
  degree: z.string().optional(),
  field: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export const ProfileSchema = z
  .object({
    publicId: z.string(),
    urn: z.string().optional(),
    url: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    fullName: z.string(),
    headline: z.string().optional(),
    title: z.string().optional(),
    company: z.string().optional(),
    companyUrn: z.string().optional(),
    location: z.string().optional(),
    industry: z.string().optional(),
    photoUrl: z.string().optional(),
    photoDataUrl: z.string().optional(),
    pageText: z.string().optional(),
    skills: z.array(z.string()).optional(),
    connectionDegree: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    experience: z.array(ExperienceSchema).optional(),
    education: z.array(EducationSchema).optional(),
    capturedAt: z.number(),
    source: z.string().optional(),
  })
  .passthrough();

export const CompanySchema = z
  .object({
    universalName: z.string(),
    urn: z.string().optional(),
    name: z.string(),
    url: z.string(),
    industry: z.string().optional(),
    size: z.string().optional(),
    hq: z.string().optional(),
    website: z.string().optional(),
    description: z.string().optional(),
    followerCount: z.number().optional(),
    capturedAt: z.number(),
  })
  .passthrough();

export const EngagerSchema = ProfileSchema.extend({
  reaction: z.string().optional(),
  commentText: z.string().optional(),
  engagedAt: z.number().optional(),
});

export const ThreadSchema = z
  .object({
    threadId: z.string(),
    participants: z.array(z.object({ publicId: z.string(), fullName: z.string() })),
    lastMessageAt: z.number(),
    unread: z.boolean(),
    snippet: z.string(),
    sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
  })
  .passthrough();

export const MessageSchema = z
  .object({
    messageId: z.string(),
    threadId: z.string(),
    fromPublicId: z.string(),
    body: z.string(),
    sentAt: z.number(),
  })
  .passthrough();

export const ListSchema = z
  .object({
    listId: z.string(),
    name: z.string(),
    tags: z.array(z.string()),
    createdAt: z.number(),
    count: z.number(),
  })
  .passthrough();

export const ListMemberSchema = z
  .object({
    publicId: z.string(),
    profile: ProfileSchema,
    addedAt: z.number(),
    tags: z.array(z.string()),
    contactedBefore: z.boolean(),
    signals: z.array(z.string()).optional(),
  })
  .passthrough();

export const STEP_TYPES = [
  'view',
  'follow',
  'invite',
  'message',
  'inmail',
  'like',
  'comment',
  'wait',
  'branch',
] as const;

export type Step = {
  type: (typeof STEP_TYPES)[number];
  note?: string;
  body?: string;
  subject?: string;
  variants?: string[];
  waitMs?: number;
  branch?: {
    on: 'accepted' | 'replied' | 'notAcceptedAfterMs';
    ms?: number;
    then: Step[];
    else: Step[];
  };
};

export const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z
    .object({
      type: z.enum(STEP_TYPES),
      note: z.string().optional(),
      body: z.string().optional(),
      subject: z.string().optional(),
      variants: z.array(z.string()).optional(),
      waitMs: z.number().optional(),
      branch: z
        .object({
          on: z.enum(['accepted', 'replied', 'notAcceptedAfterMs']),
          ms: z.number().optional(),
          then: z.array(StepSchema),
          else: z.array(StepSchema),
        })
        .optional(),
    })
    .passthrough(),
);

export const CampaignSchema = z
  .object({
    campaignId: z.string(),
    name: z.string(),
    steps: z.array(StepSchema),
    status: z.enum(['active', 'paused', 'completed']),
    createdAt: z.number(),
    settings: z.object({ stopOnReply: z.boolean(), autopilot: z.boolean() }).passthrough(),
    stats: z
      .object({
        enrolled: z.number(),
        sent: z.number(),
        accepted: z.number(),
        replied: z.number(),
        positive: z.number(),
        byStep: z.record(z.string(), z.record(z.string(), z.number())),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const QUEUE_ACTIONS = [
  'outreach.invite',
  'outreach.message',
  'outreach.inmail',
  'outreach.comment',
] as const;

export const QueueItemSchema = z
  .object({
    id: z.string(),
    action: z.enum(QUEUE_ACTIONS),
    params: z.record(z.string(), z.unknown()),
    origin: z.enum(['popup', 'campaign', 'mcp', 'cli']),
    profile: ProfileSchema.optional(),
    createdAt: z.number(),
    status: z.enum(['pending', 'approved', 'rejected', 'sent', 'failed']),
    result: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const ResearchRowSchema = z
  .object({
    name: z.string().optional(),
    linkedinUrl: z.string().optional(),
    email: z.string().optional(),
    domain: z.string().optional(),
    company: z.string().optional(),
  })
  .passthrough();

export const ResolvedRowSchema = z
  .object({
    row: ResearchRowSchema,
    kind: z.enum(['person', 'company', 'unresolved']),
    publicId: z.string().optional(),
    universalName: z.string().optional(),
    confidence: z.number(),
    candidates: z.array(ProfileSchema).optional(),
  })
  .passthrough();

export const PackSchema = z
  .object({
    row: ResearchRowSchema,
    resolved: ResolvedRowSchema,
    profile: ProfileSchema.optional(),
    company: CompanySchema.optional(),
    recentPosts: z
      .array(
        z
          .object({
            url: z.string(),
            text: z.string(),
            likes: z.number().optional(),
            comments: z.number().optional(),
            postedAt: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
    mutualConnections: z.number().optional(),
    connectionStatus: z.enum(['connected', 'pending', 'none']).optional(),
    signals: z.array(z.string()),
    enrichment: z
      .object({
        email: z.string().optional(),
        phone: z.string().optional(),
        provider: z.string().optional(),
      })
      .passthrough()
      .optional(),
    markdown: z.string(),
    csvRow: z.record(z.string(), z.string()),
  })
  .passthrough();

export const WriteResultSchema = z
  .object({
    status: z.enum(['sent', 'queued', 'dryRun']),
    queueId: z.string().optional(),
    wouldSend: z.record(z.string(), z.unknown()).optional(),
    sentAt: z.number().optional(),
  })
  .passthrough();

export const RateLimitSchema = z
  .object({
    hourlyUsed: z.number(),
    hourlyCap: z.number(),
    dailyUsed: z.number(),
    dailyCap: z.number(),
    nextAllowedAt: z.number(),
  })
  .passthrough();

export const QUOTA_KINDS = ['invite', 'message', 'visit', 'search'] as const;

/** One word per endpoint, from `status.get { verify: true }`. */
export const ENDPOINT_RESULTS = ['ok', 'failed', 'unverified', 'skipped'] as const;
export type EndpointResult = (typeof ENDPOINT_RESULTS)[number];

export const EndpointReportSchema = z.record(z.string(), z.enum(ENDPOINT_RESULTS));

export const StatusSchema = z
  .object({
    connected: z.literal(true),
    extensionVersion: z.string(),
    loggedIn: z.boolean(),
    autopilot: z.boolean(),
    businessHours: z.boolean(),
    backoffUntil: z.number().optional(),
    challenge: z.object({ detectedAt: z.number() }).optional(),
    quotas: z.record(z.enum(QUOTA_KINDS), RateLimitSchema),
    queue: z.object({ pending: z.number() }).passthrough(),
    campaigns: z.object({ active: z.number(), paused: z.number() }).passthrough(),
    // Present only when the call asked to verify.
    endpoints: EndpointReportSchema.optional(),
    clientVersionCaptured: z.string().optional(),
    endpointsCapturedAt: z.string().optional(),
    endpointErrors: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export const AI_PROVIDERS = [
  'none',
  'anthropic',
  'openai',
  'gemini',
  'ollama',
  'openai-compatible',
] as const;

export const ACCOUNT_PRESETS = ['free', 'premium', 'salesnav', 'recruiter'] as const;

export const ConfigSchema = z
  .object({
    minDelayMs: z.number(),
    maxDelayMs: z.number(),
    hourlyCap: z.number(),
    dailyInviteCap: z.number(),
    dailyMessageCap: z.number(),
    dailyVisitCap: z.number(),
    dailySearchCap: z.number(),
    businessHoursOnly: z.boolean(),
    businessStart: z.number(),
    businessEnd: z.number(),
    weekdaysOnly: z.boolean(),
    autopilot: z.boolean(),
    accountPreset: z.enum(ACCOUNT_PRESETS),
    warmup: z
      .object({
        enabled: z.boolean(),
        startedAt: z.number().optional(),
        days: z.number(),
      })
      .passthrough(),
    ai: z
      .object({
        provider: z.enum(AI_PROVIDERS),
        model: z.string().optional(),
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
      })
      .passthrough(),
    bridge: z
      .object({ enabled: z.boolean(), port: z.number(), token: z.string().optional() })
      .passthrough(),
    webhookUrl: z.string().optional(),
  })
  .passthrough();

/** `config.set` takes a partial Config; hard ceilings are clamped by the extension. */
export const PartialConfigSchema = ConfigSchema.partial();

/* ------------------------------------------------------------------ *
 * Error codes and events
 * ------------------------------------------------------------------ */

export const ERROR_CODES = [
  'EXTENSION_OFFLINE',
  'NOT_LOGGED_IN',
  'RATE_LIMITED',
  'CHALLENGE_DETECTED',
  'QUOTA_EXCEEDED',
  'OUTSIDE_BUSINESS_HOURS',
  'INVALID_PARAMS',
  'NOT_FOUND',
  'LINKEDIN_ERROR',
  'AI_NOT_CONFIGURED',
  'AI_ERROR',
  'UNAUTHORIZED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const EVENTS = [
  'invite_accepted',
  'reply_received',
  'positive_reply',
  'campaign_step_done',
  'campaign_completed',
  'quota_hit',
  'challenge_detected',
  'queue_item_added',
  'queue_item_sent',
  'campaign_note_truncated',
  'research_progress',
  'research_completed',
] as const;

export type EventName = (typeof EVENTS)[number];

/* ------------------------------------------------------------------ *
 * Envelope
 * ------------------------------------------------------------------ */

/**
 * Who asked for a request, carried on the bridge frame so the extension can
 * apply Copilot-mode approval to agent-originated writes. Optional: a frame
 * without it is treated exactly as before.
 */
export const REQUEST_ORIGINS = ['mcp', 'cli'] as const;
export type RequestOrigin = (typeof REQUEST_ORIGINS)[number];

export const ORIGIN_HEADER = 'x-linkedin-toolkit-origin';

export const ErrorShapeSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  retryAfter: z.number().optional(),
  howToFix: z.string().optional(),
});

export const EnvelopeSchema = z.union([
  z.object({
    id: z.string(),
    ok: z.literal(true),
    data: z.unknown(),
    rateLimit: RateLimitSchema.optional(),
  }),
  z.object({ id: z.string(), ok: z.literal(false), error: ErrorShapeSchema }),
]);

export type Envelope =
  | { id: string; ok: true; data: unknown; rateLimit?: z.infer<typeof RateLimitSchema> }
  | { id: string; ok: false; error: z.infer<typeof ErrorShapeSchema> };

export const BridgeEventSchema = z.object({
  event: z.enum(EVENTS),
  payload: z.unknown(),
});

/* ------------------------------------------------------------------ *
 * Params: one zod object per action
 * ------------------------------------------------------------------ */

const Empty = z.object({});
const Pagination = { start: z.number().int().min(0).optional(), count: z.number().int().min(1).optional() };

export const PARAMS = {
  'status.get': z.object({
    verify: z.boolean().optional(),
    postUrl: z.string().optional(),
  }),
  'config.get': Empty,
  'config.set': PartialConfigSchema,

  'search.people': z.object({
    keywords: z.string(),
    title: z.string().optional(),
    company: z.string().optional(),
    location: z.string().optional(),
    source: z.enum(['search', 'salesnav', 'recruiter']).optional(),
    start: z.number().int().min(0).optional(),
    count: z.number().int().min(1).max(100).optional(),
  }),
  'profile.get': z.object({
    url: z.string().optional(),
    publicId: z.string().optional(),
    full: z.boolean().optional(),
  }),
  'profile.export': z.object({ urls: z.array(z.string()), full: z.boolean().optional() }),

  'company.get': z.object({ url: z.string().optional(), universalName: z.string().optional() }),
  'company.employees': z.object({ universalName: z.string(), ...Pagination }),

  'post.engagers': z.object({
    postUrl: z.string(),
    kind: z.enum(['likes', 'comments', 'both']),
    ...Pagination,
  }),
  'group.members': z.object({ groupUrl: z.string(), ...Pagination }),
  'event.attendees': z.object({ eventUrl: z.string(), ...Pagination }),

  'network.connections': z.object({ ...Pagination }),
  'network.followers': z.object({ ...Pagination }),
  'network.status': z.object({ publicIds: z.array(z.string()) }),
  'network.unfollowCount': Empty,
  'network.unfollowAll': Empty,

  'outreach.view': z.object({ publicId: z.string() }),
  'outreach.follow': z.object({ publicId: z.string() }),
  'outreach.invite': z.object({ publicId: z.string(), note: z.string().optional() }),
  'outreach.message': z.object({ publicId: z.string(), body: z.string() }),
  'outreach.inmail': z.object({ publicId: z.string(), subject: z.string(), body: z.string() }),
  'outreach.like': z.object({ postUrl: z.string() }),
  'outreach.comment': z.object({ postUrl: z.string(), body: z.string() }),

  'inbox.threads': z.object({
    since: z.number().optional(),
    unreadOnly: z.boolean().optional(),
    count: z.number().int().min(1).optional(),
  }),
  'inbox.messages': z.object({ threadId: z.string(), since: z.number().optional() }),
  'inbox.export': z.object({ since: z.number().optional() }),

  'list.create': z.object({ name: z.string(), tags: z.array(z.string()).optional() }),
  'list.getAll': Empty,
  'list.get': z.object({ listId: z.string() }),
  'list.add': z.object({
    listId: z.string(),
    profiles: z.array(ProfileSchema).optional(),
    publicIds: z.array(z.string()).optional(),
  }),
  'list.remove': z.object({ listId: z.string(), publicIds: z.array(z.string()) }),
  'list.members': z.object({ listId: z.string(), ...Pagination }),
  'list.delete': z.object({ listId: z.string() }),
  'list.importCsv': z.object({ listId: z.string(), csv: z.string() }),

  'campaign.create': z.object({
    name: z.string(),
    steps: z.array(StepSchema),
    listId: z.string().optional(),
    publicIds: z.array(z.string()).optional(),
    settings: z
      .object({ stopOnReply: z.boolean().optional(), autopilot: z.boolean().optional() })
      .passthrough()
      .optional(),
  }),
  'campaign.getAll': Empty,
  'campaign.get': z.object({ campaignId: z.string() }),
  'campaign.enroll': z.object({ campaignId: z.string(), publicIds: z.array(z.string()) }),
  'campaign.pause': z.object({ campaignId: z.string() }),
  'campaign.resume': z.object({ campaignId: z.string() }),
  'campaign.delete': z.object({ campaignId: z.string() }),
  'campaign.tick': Empty,

  'queue.list': z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'sent', 'failed']).optional(),
  }),
  'queue.approve': z.object({
    ids: z.array(z.string()),
    edits: z
      .record(z.string(), z.object({ note: z.string().optional(), body: z.string().optional() }))
      .optional(),
  }),
  'queue.reject': z.object({ ids: z.array(z.string()) }),

  'ai.complete': z.object({
    task: z.enum(['opener', 'summary', 'sentiment', 'comment', 'score']),
    input: z.record(z.string(), z.unknown()),
  }),

  'export.csv': z.object({
    kind: z.enum(['profiles', 'list', 'campaign', 'inbox']),
    id: z.string().optional(),
  }),

  'research.resolve': z.object({ rows: z.array(ResearchRowSchema) }),
  'research.pack': z.object({
    rows: z.array(ResearchRowSchema),
    listName: z.string().optional(),
    enrich: z.boolean().optional(),
    full: z.boolean().optional(),
  }),
  'research.get': z.object({ jobId: z.string() }),

  'sync.pull': z.object({ since: z.number().optional() }),
} as const;

export type ActionName = keyof typeof PARAMS;

export const ACTIONS = Object.keys(PARAMS) as ActionName[];

export function isAction(name: string): name is ActionName {
  return Object.prototype.hasOwnProperty.call(PARAMS, name);
}

/* ------------------------------------------------------------------ *
 * Results: one zod object per action (used for OpenAPI response schemas)
 * ------------------------------------------------------------------ */

const ProfilePage = z.object({
  profiles: z.array(ProfileSchema),
  total: z.number().optional(),
  nextStart: z.number().optional(),
});

export const RESULTS = {
  'status.get': StatusSchema,
  'config.get': ConfigSchema,
  'config.set': ConfigSchema,
  'search.people': ProfilePage,
  'profile.get': ProfileSchema,
  'profile.export': z.object({
    profiles: z.array(ProfileSchema),
    failed: z.array(z.object({ url: z.string(), error: z.string() })),
  }),
  'company.get': CompanySchema,
  'company.employees': ProfilePage,
  'post.engagers': z.object({
    engagers: z.array(EngagerSchema),
    nextStart: z.number().optional(),
  }),
  'group.members': ProfilePage,
  'event.attendees': ProfilePage,
  'network.connections': ProfilePage,
  'network.followers': ProfilePage,
  'network.status': z.object({
    statuses: z.record(z.string(), z.enum(['connected', 'pending', 'none'])),
  }),
  'network.unfollowCount': z.object({ count: z.number() }),
  'network.unfollowAll': z.object({ unfollowed: z.number() }),
  'outreach.view': WriteResultSchema,
  'outreach.follow': WriteResultSchema,
  'outreach.invite': WriteResultSchema,
  'outreach.message': WriteResultSchema,
  'outreach.inmail': WriteResultSchema,
  'outreach.like': WriteResultSchema,
  'outreach.comment': WriteResultSchema,
  'inbox.threads': z.object({ threads: z.array(ThreadSchema) }),
  'inbox.messages': z.object({ messages: z.array(MessageSchema) }),
  'inbox.export': z.object({ threads: z.array(ThreadSchema), messages: z.array(MessageSchema) }),
  'list.create': ListSchema,
  'list.getAll': z.object({ lists: z.array(ListSchema) }),
  'list.get': ListSchema,
  'list.add': z.object({ added: z.number(), duplicates: z.number() }),
  'list.remove': z.object({ removed: z.number() }),
  'list.members': z.object({ members: z.array(ListMemberSchema), total: z.number() }),
  'list.delete': z.object({ ok: z.literal(true) }),
  'list.importCsv': z.object({
    added: z.number(),
    duplicates: z.number(),
    invalid: z.number(),
  }),
  'campaign.create': CampaignSchema,
  'campaign.getAll': z.object({ campaigns: z.array(CampaignSchema) }),
  'campaign.get': CampaignSchema,
  'campaign.enroll': z.object({ enrolled: z.number(), skipped: z.number() }),
  'campaign.pause': CampaignSchema,
  'campaign.resume': CampaignSchema,
  'campaign.delete': CampaignSchema,
  'campaign.tick': z.object({ executed: z.number(), queued: z.number() }),
  'queue.list': z.object({ items: z.array(QueueItemSchema) }),
  'queue.approve': z.object({ approved: z.number() }),
  'queue.reject': z.object({ rejected: z.number() }),
  'ai.complete': z.object({
    output: z.union([z.string(), z.record(z.string(), z.unknown())]),
    provider: z.string(),
    model: z.string().optional(),
  }),
  'export.csv': z.object({ csv: z.string(), filename: z.string() }),
  'research.resolve': z.object({ resolved: z.array(ResolvedRowSchema) }),
  'research.pack': z.object({ jobId: z.string(), total: z.number(), etaMs: z.number().optional() }),
  'research.get': z.object({
    jobId: z.string(),
    status: z.string(),
    done: z.number(),
    total: z.number(),
    packs: z.array(PackSchema),
  }),
  'sync.pull': z.object({
    profiles: z.array(ProfileSchema).optional(),
    lists: z.array(ListSchema).optional(),
    listMembers: z.array(z.record(z.string(), z.unknown())).optional(),
    campaigns: z.array(CampaignSchema).optional(),
    enrollments: z.array(z.record(z.string(), z.unknown())).optional(),
    actions: z.array(z.record(z.string(), z.unknown())).optional(),
    threads: z.array(ThreadSchema).optional(),
    messages: z.array(MessageSchema).optional(),
    events: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
};

/* ------------------------------------------------------------------ *
 * Write actions
 * ------------------------------------------------------------------ */

export const WRITE_ACTIONS: ReadonlySet<ActionName> = new Set<ActionName>([
  'config.set',
  'outreach.view',
  'outreach.follow',
  'outreach.invite',
  'outreach.message',
  'outreach.inmail',
  'outreach.like',
  'outreach.comment',
  'list.create',
  'list.add',
  'list.remove',
  'list.delete',
  'list.importCsv',
  'campaign.create',
  'campaign.enroll',
  'campaign.pause',
  'campaign.resume',
  'campaign.delete',
  'queue.approve',
  'queue.reject',
  'research.pack',
]);

export function isWriteAction(action: ActionName): boolean {
  return WRITE_ACTIONS.has(action);
}

/* ------------------------------------------------------------------ *
 * MCP tool mapping
 * ------------------------------------------------------------------ */

export type ToolDef = {
  name: string;
  /** The bridge action this tool calls. `null` for server-local tools. */
  action: ActionName | null;
  description: string;
  write: boolean;
};

/** Server-local tools that do not proxy a single bridge action. */
export const SQL_QUERY_PARAMS = z.object({
  sql: z.string(),
  params: z.array(z.union([z.string(), z.number(), z.null()])).optional(),
});

export const SYNC_PARAMS = z.object({ since: z.number().optional() });

/** `linkedin_endpoints_check` always verifies; the post is an optional probe. */
export const ENDPOINTS_CHECK_PARAMS = z.object({ postUrl: z.string().optional() });

export const TOOLS: ToolDef[] = [
  {
    name: 'linkedin_get_status',
    action: 'status.get',
    description:
      'Check that the Chrome extension is connected and the user is logged in to LinkedIn. Call this first in any session and again after a rate-limit error; returns extension version, autopilot on/off, business-hours flag, per-quota usage (invite, message, visit, search), pending approval-queue size and campaign counts.',
    write: false,
  },
  {
    name: 'linkedin_endpoints_check',
    action: 'status.get',
    description:
      'Self-test every LinkedIn endpoint the extension uses; run this first when a tool returns LINKEDIN_ERROR. One read-only call per endpoint reports ok, failed, unverified or skipped, plus the LinkedIn client version the endpoint table was captured against, so you can tell "LinkedIn moved" from "the toolkit is broken". The search and profile reads it makes count against the normal daily caps.',
    write: false,
  },
  {
    name: 'linkedin_search_people',
    action: 'search.people',
    description:
      'Search LinkedIn people and return structured profiles. Use it to build a candidate or prospect list from keywords plus optional title, company and location filters. Returns up to 100 profiles per call with nextStart for paging; the extension caps search results at 1,000 per day.',
    write: false,
  },
  {
    name: 'linkedin_get_profile',
    action: 'profile.get',
    description:
      'Fetch one profile by URL or publicId. Use it before writing an invite or message so the copy can reference real detail. Returns the Profile; with full=true it also captures the rendered page text, photo and experience/education, which costs one profile visit against the 500/day cap.',
    write: false,
  },
  {
    name: 'linkedin_export_profiles',
    action: 'profile.export',
    description:
      'Fetch many profiles in one call from a list of LinkedIn URLs. Use it to hydrate a list you already have URLs for. Returns profiles plus a failed array of {url, error}; each profile counts against the 500 visits/day cap, so keep batches modest.',
    write: false,
  },
  {
    name: 'linkedin_get_company',
    action: 'company.get',
    description:
      'Fetch a company page by URL or universalName. Use it for account research before outreach. Returns name, industry, size, HQ, website, description and follower count.',
    write: false,
  },
  {
    name: 'linkedin_get_company_employees',
    action: 'company.employees',
    description:
      'List people who work at a company, by universalName. Use it for account-based sourcing once you know the company. Returns a page of profiles plus nextStart; results count against the daily search cap.',
    write: false,
  },
  {
    name: 'linkedin_get_post_engagers',
    action: 'post.engagers',
    description:
      'List the people who liked or commented on a LinkedIn post. Use it to source warm leads who have shown intent. Returns engagers (a profile plus reaction or comment text) and nextStart.',
    write: false,
  },
  {
    name: 'linkedin_get_group_members',
    action: 'group.members',
    description:
      'List members of a LinkedIn group you belong to. Use it for niche sourcing. Returns a page of profiles plus nextStart.',
    write: false,
  },
  {
    name: 'linkedin_get_event_attendees',
    action: 'event.attendees',
    description:
      'List attendees of a LinkedIn event you can see. Use it to source people around a conference or webinar. Returns a page of profiles plus nextStart.',
    write: false,
  },
  {
    name: 'linkedin_get_connections',
    action: 'network.connections',
    description:
      "List the user's own first-degree connections. Use it to work an existing network rather than sending new invites. Returns a page of profiles plus nextStart.",
    write: false,
  },
  {
    name: 'linkedin_get_connection_status',
    action: 'network.status',
    description:
      'Check whether the user is already connected to, or has a pending invite with, each of the given publicIds. Always call this before sending invites so you do not re-invite existing connections. Returns a map publicId to connected | pending | none.',
    write: false,
  },
  {
    name: 'linkedin_get_conversations',
    action: 'inbox.threads',
    description:
      'List LinkedIn inbox threads, optionally only those since a timestamp or only unread. Use it to triage replies. Returns threads with participants, snippet, unread flag and sentiment when the extension has an AI provider configured.',
    write: false,
  },
  {
    name: 'linkedin_get_messages',
    action: 'inbox.messages',
    description:
      'Fetch the messages in one thread by threadId. Use it after linkedin_get_conversations to read the full exchange before replying. Returns messages with sender publicId, body and sentAt.',
    write: false,
  },
  {
    name: 'linkedin_list_create',
    action: 'list.create',
    description:
      'Create a named local list to hold prospects. Use it as the container for search results before enrolling them in a campaign. Returns the List with its listId. Lists live only in the local extension storage.',
    write: true,
  },
  {
    name: 'linkedin_list_get',
    action: 'list.get',
    description:
      'Fetch one list by listId. Use it to confirm a list exists and how many members it holds. Returns the List record.',
    write: false,
  },
  {
    name: 'linkedin_list_all',
    action: 'list.getAll',
    description:
      'List every local list. Use it to discover listIds before adding members or creating a campaign. Returns all List records with their member counts.',
    write: false,
  },
  {
    name: 'linkedin_list_add',
    action: 'list.add',
    description:
      'Add profiles (or bare publicIds) to a list. Use it to save search or engager results for later outreach. Duplicates are skipped; returns {added, duplicates}.',
    write: true,
  },
  {
    name: 'linkedin_list_members',
    action: 'list.members',
    description:
      'Page through the members of a list. Use it to read back what is in a list, including tags, whether each person was contacted before and any signals. Returns members plus total.',
    write: false,
  },
  {
    name: 'linkedin_view_profile',
    action: 'outreach.view',
    description:
      'Visit a profile so the visit shows up in their "who viewed your profile". Use it as a light warm-up touch before an invite. This is a direct, metered action: it is paced and drawn from the visit bucket (500 visits/day) but never queued for approval, so the result status is "sent". Pass dry_run to preview.',
    write: true,
  },
  {
    name: 'linkedin_follow',
    action: 'outreach.follow',
    description:
      'Follow a person without sending a connection invite. Use it when an invite would be too strong a first touch. This is a direct, metered action: it is paced and drawn from the visit bucket but never queued for approval, so the result status is "sent". Pass dry_run to preview.',
    write: true,
  },
  {
    name: 'linkedin_send_invite',
    action: 'outreach.invite',
    description:
      'Send a connection invite, optionally with a note of at most 200 characters (LinkedIn\'s own limit; a longer note is refused with INVALID_PARAMS, so aim for 180 or fewer). Check linkedin_get_connection_status first. Hard cap 100 invites/day; in Copilot mode (the default) the invite is queued for human approval and the result status is "queued" rather than "sent". Note that on a free account LinkedIn allows only a few personalised (with-note) invitations a month, so prefer a note where it will count. Pass dry_run to preview the exact payload.',
    write: true,
  },
  {
    name: 'linkedin_send_message',
    action: 'outreach.message',
    description:
      'Send a direct message to a first-degree connection. Hard cap 150 messages/day; in Copilot mode it is queued for approval. Returns a WriteResult; pass dry_run to preview.',
    write: true,
  },
  {
    name: 'linkedin_send_inmail',
    action: 'outreach.inmail',
    description:
      'Send an InMail with a subject line (requires Premium, Sales Navigator or Recruiter). Counts against the message cap and queues for approval in Copilot mode. Returns a WriteResult; pass dry_run to preview.',
    write: true,
  },
  {
    name: 'linkedin_like_post',
    action: 'outreach.like',
    description:
      'Like a post by URL. Use it as a low-risk warm-up touch before inviting the author. This is a direct, metered action: it is paced and drawn from the visit bucket but never queued for approval, so the result status is "sent". Unlike a comment, a like carries no words of yours. Pass dry_run to preview.',
    write: true,
  },
  {
    name: 'linkedin_comment_post',
    action: 'outreach.comment',
    description:
      'Comment on a post by URL. Use it for public engagement before outreach; comments are queued for approval in Copilot mode because they are visible to everyone. Returns a WriteResult; pass dry_run to preview.',
    write: true,
  },
  {
    name: 'linkedin_campaign_create',
    action: 'campaign.create',
    description:
      'Create a multi-step outreach sequence (view, follow, invite, message, inmail, like, comment, wait, branch) over a list or explicit publicIds. Use it instead of firing individual writes when the touches should be spaced over days. Returns the Campaign; steps still obey every quota and the approval queue.',
    write: true,
  },
  {
    name: 'linkedin_campaign_get',
    action: 'campaign.get',
    description:
      'Fetch one campaign by campaignId including its stats. Use it to report on enrolled, sent, accepted, replied and positive counts per step.',
    write: false,
  },
  {
    name: 'linkedin_campaign_list',
    action: 'campaign.getAll',
    description:
      'List every campaign with its status. Use it to find campaignIds and see what is currently running or paused.',
    write: false,
  },
  {
    name: 'linkedin_campaign_enroll',
    action: 'campaign.enroll',
    description:
      'Enroll publicIds into an existing campaign. Use it to top up a running sequence with newly sourced people. Already-enrolled people are skipped; returns {enrolled, skipped}.',
    write: true,
  },
  {
    name: 'linkedin_campaign_pause',
    action: 'campaign.pause',
    description:
      'Pause a campaign so no further steps execute. Use it immediately if replies look negative or a challenge was detected. Returns the updated Campaign.',
    write: true,
  },
  {
    name: 'linkedin_campaign_resume',
    action: 'campaign.resume',
    description:
      'Resume a paused campaign from where it stopped. Returns the updated Campaign.',
    write: true,
  },
  {
    name: 'linkedin_queue_list',
    action: 'queue.list',
    description:
      'List items in the human-approval queue, optionally filtered by status ("pending", "approved", "rejected", "sent" or "failed"). In Copilot mode every agent-originated write lands here first, so call this to show the user what is waiting, and poll it after linkedin_queue_approve to see what actually sent. Returns queue items with their action, params and target profile; a failed item carries result.error.',
    write: false,
  },
  {
    name: 'linkedin_queue_approve',
    action: 'queue.approve',
    description:
      'Approve queued writes by id so the extension sends them, optionally editing the note or body first. This works only when the user has turned Autopilot on: in the default Copilot mode approval is a human action and the extension answers UNAUTHORIZED, so show the queue with linkedin_queue_list and ask the user to approve in the popup. Returns {approved} immediately — the count marked approved, not sent. The extension then sends them one at a time at human pace, which takes seconds to minutes, so watch queue_item_sent events or poll linkedin_queue_list (status "sent" or "failed") rather than assuming the writes have landed when this returns. An edited note longer than 200 characters is refused here with INVALID_PARAMS and nothing is approved.',
    write: true,
  },
  {
    name: 'linkedin_queue_reject',
    action: 'queue.reject',
    description:
      'Reject queued writes by id so they are never sent. Like approving, this works only when the user has turned Autopilot on; in the default Copilot mode the extension answers UNAUTHORIZED and the user rejects in the popup. Returns {rejected}.',
    write: true,
  },
  {
    name: 'linkedin_research_pack',
    action: 'research.pack',
    description:
      'Turn a list of rows (name, LinkedIn URL, email, domain or company) into full research packs: resolved profile, company, recent posts, mutual connections, connection status, signals and a ready-to-read markdown brief per row. Use it as the one-shot "research these people for me" tool. The server waits for the job to finish and returns the packs; if it takes longer than the research timeout it returns {jobId, status:"running"} and you should poll linkedin_research_get.',
    write: true,
  },
  {
    name: 'linkedin_research_get',
    action: 'research.get',
    description:
      'Poll a research job by jobId. Use it after linkedin_research_pack returned status "running". Returns {jobId, status, done, total, packs} with the packs finished so far.',
    write: false,
  },
  {
    name: 'linkedin_research_resolve',
    action: 'research.resolve',
    description:
      'Resolve messy rows (a name, an email, a company domain) to LinkedIn people or companies without doing the full research gather. Use it as a cheap first pass to check match quality before spending visits on linkedin_research_pack. Returns each row with kind, publicId or universalName, a confidence score and candidate profiles.',
    write: false,
  },
  {
    name: 'linkedin_query_sql',
    action: null,
    description:
      'Run a read-only SQL query against the local SQLite mirror of everything the toolkit has captured (tables: profiles, companies, searches, search_results, lists, list_members, campaigns, enrollments, actions, conversations, messages, events, packs). Use it for counting, filtering and joining across past work instead of re-scraping LinkedIn. Only a single SELECT or WITH statement is allowed and at most 1,000 rows are returned.',
    write: false,
  },
  {
    name: 'linkedin_sync',
    action: 'sync.pull',
    description:
      'Pull everything changed in the extension since the last sync into the local SQLite mirror. Call it before linkedin_query_sql so the database is current. Returns per-table row counts and the new sync timestamp.',
    write: false,
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export function toolByName(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Input schema for a tool, including `dry_run` for write tools. */
export function toolInputSchema(tool: ToolDef): z.ZodObject<z.ZodRawShape> {
  let base: z.ZodObject<z.ZodRawShape>;
  if (tool.name === 'linkedin_query_sql') base = SQL_QUERY_PARAMS;
  else if (tool.name === 'linkedin_sync') base = SYNC_PARAMS;
  else if (tool.name === 'linkedin_endpoints_check') base = ENDPOINTS_CHECK_PARAMS;
  else base = PARAMS[tool.action as ActionName] as unknown as z.ZodObject<z.ZodRawShape>;
  return tool.write ? base.extend({ dry_run: z.boolean().optional() }) : base;
}

/* ------------------------------------------------------------------ *
 * MCP resources and prompts
 * ------------------------------------------------------------------ */

export const RESOURCES = [
  {
    name: 'status',
    uri: 'linkedin://status',
    description: 'Live connection, quota and queue status of the LinkedIn Toolkit extension.',
    mimeType: 'application/json',
  },
  {
    name: 'profile',
    uriTemplate: 'linkedin://profile/{publicId}',
    description: 'One LinkedIn profile by publicId, fetched live through the extension.',
    mimeType: 'application/json',
  },
  {
    name: 'list',
    uriTemplate: 'linkedin://list/{listId}',
    description: 'One local prospect list with its members.',
    mimeType: 'application/json',
  },
  {
    name: 'queue',
    uri: 'linkedin://queue',
    description: 'The pending human-approval queue.',
    mimeType: 'application/json',
  },
] as const;

export const PROMPTS = [
  {
    name: 'source-candidates',
    description:
      'Source and shortlist people on LinkedIn from a short brief, saving them to a list.',
    args: { brief: z.string(), count: z.string().optional() },
  },
  {
    name: 'write-opener',
    description: 'Draft a short, specific connection-request opener for one person.',
    args: { publicId: z.string(), tone: z.string().optional() },
  },
  {
    name: 'triage-inbox',
    description: 'Triage recent LinkedIn replies into positive, neutral and negative buckets.',
    args: { since: z.string().optional() },
  },
] as const;

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type Profile = z.infer<typeof ProfileSchema>;
export type Company = z.infer<typeof CompanySchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type MessageRecord = z.infer<typeof MessageSchema>;
export type ListRecord = z.infer<typeof ListSchema>;
export type ListMember = z.infer<typeof ListMemberSchema>;
export type Campaign = z.infer<typeof CampaignSchema>;
export type QueueItem = z.infer<typeof QueueItemSchema>;
export type Pack = z.infer<typeof PackSchema>;
export type Status = z.infer<typeof StatusSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type ResearchRow = z.infer<typeof ResearchRowSchema>;
export type ResolvedRow = z.infer<typeof ResolvedRowSchema>;
export type WriteResult = z.infer<typeof WriteResultSchema>;

/**
 * Compile-time proof that dropping the `RESULTS` annotation did not let an
 * action fall out of the object. `true` when every action has a result schema.
 */
export type ResultsCoverEveryAction = ActionName extends keyof typeof RESULTS ? true : never;
