# Action Contract

This file is the source of truth for the LinkedIn Toolkit v2 contract. Every layer — the extension engine, the popup, the localhost bridge, the MCP server, the `lit` CLI, the Node and Python clients and the n8n nodes — speaks exactly these action names, parameter shapes, result shapes, error codes and event names. The runtime constants (`ACTIONS`, `ERROR`, `EVENTS`, `HARD_CAPS`, `DEFAULT_CONFIG`) live in `extension/src/lib/actions.js` and must stay in lockstep with the tables below; a new action, error code or event is only real once it is added here. Hard caps are enforced in the extension and cannot be raised by any client.

### Action names (engine switch, popup, bridge, CLI, clients all use these)

| Action | Params | Result `data` |
|---|---|---|
| `status.get` | `{}` | `Status` |
| `config.get` | `{}` | `Config` |
| `config.set` | `Partial<Config>` | `Config` |
| `search.people` | `{ keywords, title?, company?, location?, source?: 'search'\|'salesnav'\|'recruiter', start?, count? }` (count ≤ 100) | `{ profiles: Profile[], total?: number, nextStart?: number }` |
| `profile.get` | `{ url?: string, publicId?: string, full?: boolean }` | `Profile` (with `pageText`, `photoDataUrl` when full) |
| `profile.export` | `{ urls: string[], full?: boolean }` | `{ profiles: Profile[], failed: {url, error}[] }` |
| `company.get` | `{ url?: string, universalName?: string }` | `Company` |
| `company.employees` | `{ universalName, start?, count? }` | `{ profiles: Profile[], nextStart? }` |
| `post.engagers` | `{ postUrl, kind: 'likes'\|'comments'\|'both', start?, count? }` | `{ engagers: Engager[], nextStart? }` |
| `group.members` | `{ groupUrl, start?, count? }` | `{ profiles: Profile[], nextStart? }` |
| `event.attendees` | `{ eventUrl, start?, count? }` | `{ profiles: Profile[], nextStart? }` |
| `network.connections` | `{ start?, count? }` | `{ profiles: Profile[], nextStart? }` |
| `network.followers` | `{ start?, count? }` | `{ profiles: Profile[], nextStart? }` |
| `network.status` | `{ publicIds: string[] }` (≤ 25) | `{ statuses: Record<string, 'connected'\|'pending'\|'none'> }` |
| `network.unfollowCount` | `{}` | `{ count: number }` |
| `network.unfollowAll` | `{}` | `{ unfollowed: number }` |
| `outreach.view` | `{ publicId }` | `WriteResult` |
| `outreach.follow` | `{ publicId }` | `WriteResult` |
| `outreach.invite` | `{ publicId, note? }` | `WriteResult` |
| `outreach.message` | `{ publicId, body }` | `WriteResult` |
| `outreach.inmail` | `{ publicId, subject, body }` | `WriteResult` |
| `outreach.like` | `{ postUrl }` | `WriteResult` |
| `outreach.comment` | `{ postUrl, body }` | `WriteResult` |
| `inbox.threads` | `{ since?: number, unreadOnly?: boolean, count? }` | `{ threads: Thread[] }` |
| `inbox.messages` | `{ threadId, since? }` | `{ messages: Message[] }` |
| `inbox.export` | `{ since? }` | `{ threads: Thread[], messages: Message[] }` |
| `list.create` | `{ name, tags? }` | `List` |
| `list.getAll` | `{}` | `{ lists: List[] }` |
| `list.get` | `{ listId }` | `List` |
| `list.add` | `{ listId, profiles: Profile[] \| publicIds: string[] }` | `{ added: number, duplicates: number }` |
| `list.remove` | `{ listId, publicIds }` | `{ removed: number }` |
| `list.members` | `{ listId, start?, count? }` | `{ members: ListMember[], total }` |
| `list.delete` | `{ listId }` | `{ ok: true }` |
| `list.importCsv` | `{ listId, csv: string }` | `{ added, duplicates, invalid }` |
| `campaign.create` | `{ name, steps: Step[], listId?, publicIds?, settings? }` | `Campaign` |
| `campaign.getAll` | `{}` | `{ campaigns: Campaign[] }` |
| `campaign.get` | `{ campaignId }` | `Campaign` (with `stats`) |
| `campaign.enroll` | `{ campaignId, publicIds }` | `{ enrolled, skipped }` |
| `campaign.pause` / `campaign.resume` / `campaign.delete` | `{ campaignId }` | `Campaign` |
| `campaign.tick` | `{}` | `{ executed: number, queued: number }` |
| `queue.list` | `{ status?: 'pending'\|'approved'\|'rejected'\|'sent' }` | `{ items: QueueItem[] }` |
| `queue.approve` | `{ ids: string[], edits?: Record<id, {note?, body?}> }` | `{ approved: number }` |
| `queue.reject` | `{ ids: string[] }` | `{ rejected: number }` |
| `ai.complete` | `{ task: 'opener'\|'summary'\|'sentiment'\|'comment'\|'score', input: object }` | `{ output: string \| object, provider, model }` |
| `export.csv` | `{ kind: 'profiles'\|'list'\|'campaign'\|'inbox', id? }` | `{ csv: string, filename }` |
| `research.resolve` | `{ rows: ResearchRow[] }` | `{ resolved: ResolvedRow[] }` |
| `research.pack` | `{ rows: ResearchRow[], listName?, enrich?: boolean, full?: boolean }` | `{ jobId, total, etaMs }` then events `research_progress {jobId, done, total, row, packSummary}`, `research_completed {jobId, listId}` |
| `research.get` | `{ jobId }` | `{ jobId, status, done, total, packs: Pack[] }` |
| `sync.pull` | `{ since?: number }` | `{ profiles, lists, listMembers, campaigns, enrollments, actions, threads, messages, events }` (all arrays, items changed since `since`) |

### Shared types

```ts
type Profile = { publicId: string; urn?: string; url: string; firstName: string; lastName: string; fullName: string;
  headline?: string; title?: string; company?: string; companyUrn?: string; location?: string; industry?: string;
  photoUrl?: string; photoDataUrl?: string; pageText?: string; skills?: string[]; connectionDegree?: 1|2|3;
  experience?: { title; company; start?; end?; description? }[]; education?: { school; degree?; field?; start?; end? }[];
  capturedAt: number; source?: string };
type Company = { universalName: string; urn?: string; name: string; url: string; industry?; size?; hq?; website?; description?; followerCount?; capturedAt: number };
type Engager = Profile & { reaction?: string; commentText?: string; engagedAt?: number };
type Thread = { threadId: string; participants: { publicId; fullName }[]; lastMessageAt: number; unread: boolean; snippet: string; sentiment?: 'positive'|'neutral'|'negative' };
type Message = { messageId: string; threadId: string; fromPublicId: string; body: string; sentAt: number };
type List = { listId: string; name: string; tags: string[]; createdAt: number; count: number };
type ListMember = { publicId: string; profile: Profile; addedAt: number; tags: string[]; contactedBefore: boolean; signals?: string[] };
type Step = { type: 'view'|'follow'|'invite'|'message'|'inmail'|'like'|'comment'|'wait'|'branch';
  note?; body?; subject?; variants?: string[]; waitMs?; branch?: { on: 'accepted'|'replied'|'notAcceptedAfterMs'; ms?; then: Step[]; else: Step[] } };
type Campaign = { campaignId: string; name: string; steps: Step[]; status: 'active'|'paused'|'completed'; createdAt: number;
  settings: { stopOnReply: boolean; autopilot: boolean }; stats?: { enrolled; sent; accepted; replied; positive; byStep: Record<number, { sent; accepted?; replied? }> } };
type QueueItem = { id: string; action: 'outreach.invite'|'outreach.message'|'outreach.inmail'|'outreach.comment'; params: object;
  origin: 'popup'|'campaign'|'mcp'|'cli'; profile?: Profile; createdAt: number; status: 'pending'|'approved'|'rejected'|'sent'|'failed'; result?: object };
type ResearchRow = { name?: string; linkedinUrl?: string; email?: string; domain?: string; company?: string; [extra: string]: unknown };
type ResolvedRow = { row: ResearchRow; kind: 'person'|'company'|'unresolved'; publicId?: string; universalName?: string; confidence: number; candidates?: Profile[] };
type Pack = { row: ResearchRow; resolved: ResolvedRow; profile?: Profile; company?: Company; recentPosts?: { url; text; likes; comments; postedAt }[];
  mutualConnections?: number; connectionStatus?: 'connected'|'pending'|'none'; signals: string[]; enrichment?: { email?; phone?; provider? };
  markdown: string; csvRow: Record<string, string> };
type WriteResult = { status: 'sent'|'queued'|'dryRun'; queueId?: string; wouldSend?: object; sentAt?: number };
type RateLimit = { hourlyUsed; hourlyCap; dailyUsed; dailyCap; nextAllowedAt: number };
type Status = { connected: true; extensionVersion: string; loggedIn: boolean; autopilot: boolean; businessHours: boolean;
  backoffUntil?: number; challenge?: { detectedAt: number }; quotas: Record<'invite'|'message'|'visit'|'search', RateLimit>;
  queue: { pending: number }; campaigns: { active: number; paused: number }; bridge: { enabled: boolean; connected: boolean; port: number } };
type Config = { minDelayMs; maxDelayMs; hourlyCap; dailyInviteCap; dailyMessageCap; dailyVisitCap; dailySearchCap;
  businessHoursOnly: boolean; businessStart: number; businessEnd: number; weekdaysOnly: boolean;
  autopilot: boolean; accountPreset: 'free'|'premium'|'salesnav'|'recruiter'; warmup: { enabled: boolean; startedAt?: number; days: 14 };
  ai: { provider: 'none'|'anthropic'|'openai'|'gemini'|'ollama'|'openai-compatible'; model?: string; baseUrl?: string; apiKey?: string };
  enrichment: { provider: 'none'|'hunter'; apiKey?: string };
  bridge: { enabled: boolean; port: number; token?: string }; webhookUrl?: string };
```

Hard ceilings are clamped in `config.set` regardless of the value requested. `config.set` also accepts the command flag `clearChallenge: true`, which clears a detected security challenge and is never persisted.

Every `profileView` fetch — `profile.get`, each row of `profile.export`, a connection check, the urn resolution before a message — is metered against the `visit` bucket and paced, because that is what LinkedIn records as a profile visit. `network.status` takes at most 25 publicIds per call and answers from the sent-invitations collection wherever it can, spending a visit only for somebody never invited.

`hourlyCap` is additionally clamped to a ceiling of 50 and paces the `invite`, `message` and `visit` buckets only; `search` is metered in results per day, not per hour.

`export.csv` reads its rows from the engine's own stores (`kind: 'profiles'` from the profile store, `'list'` from list members, `'campaign'` from enrollments and the action log, `'inbox'` from stored threads); `kind: 'profiles'` also accepts an optional `profiles: Profile[]` override, which the popup uses to download an ad-hoc result set it already holds, and an optional `download: boolean` that additionally hands the CSV to `chrome.downloads` as a `data:` URL for callers (the popup, the content script) that cannot download for themselves.

### Envelope and errors

Request `{ id: string, action: string, params: object }`.
Response `{ id, ok: true, data, rateLimit? } | { id, ok: false, error: { code, message, retryAfter?, howToFix? } }`.
Event (extension → server) `{ event: EventName, payload }`.

Error codes: `EXTENSION_OFFLINE`, `NOT_LOGGED_IN`, `RATE_LIMITED`, `CHALLENGE_DETECTED`, `QUOTA_EXCEEDED`, `OUTSIDE_BUSINESS_HOURS`, `INVALID_PARAMS`, `NOT_FOUND`, `LINKEDIN_ERROR`, `AI_NOT_CONFIGURED`, `AI_ERROR`, `UNAUTHORIZED` (bad bridge token), `INTERNAL`.

Event names: `invite_accepted`, `reply_received`, `positive_reply`, `campaign_step_done`, `campaign_completed`, `quota_hit`, `challenge_detected`, `queue_item_added`, `queue_item_sent`, `research_progress`, `research_completed`.

### Bridge protocol

- Server: WebSocket on `127.0.0.1:47829`. First frame from extension must be `{ type: 'hello', token, extensionVersion }`; server replies `{ type: 'hello_ok', serverVersion }` or closes with code 4001 (`UNAUTHORIZED`).
- Thereafter server sends requests, extension sends responses and events, per the envelope above. Server pings every 20 s; extension responds to pings natively.
- Extension reconnects with backoff 1 s → 2 s → 4 s → … → 60 s, reset on success. Reconnect on `chrome.runtime.onStartup`, `onInstalled`, and every alarm tick.

### MCP tool names → actions

`linkedin_get_status`→`status.get`, `linkedin_search_people`→`search.people`, `linkedin_get_profile`→`profile.get`, `linkedin_export_profiles`→`profile.export`, `linkedin_get_company`→`company.get`, `linkedin_get_company_employees`→`company.employees`, `linkedin_get_post_engagers`→`post.engagers`, `linkedin_get_group_members`→`group.members`, `linkedin_get_event_attendees`→`event.attendees`, `linkedin_get_connections`→`network.connections`, `linkedin_get_connection_status`→`network.status`, `linkedin_get_conversations`→`inbox.threads`, `linkedin_get_messages`→`inbox.messages`, `linkedin_list_create`→`list.create`, `linkedin_list_get`→`list.get`, `linkedin_list_all`→`list.getAll`, `linkedin_list_add`→`list.add`, `linkedin_list_members`→`list.members`, `linkedin_view_profile`→`outreach.view`, `linkedin_follow`→`outreach.follow`, `linkedin_send_invite`→`outreach.invite`, `linkedin_send_message`→`outreach.message`, `linkedin_send_inmail`→`outreach.inmail`, `linkedin_like_post`→`outreach.like`, `linkedin_comment_post`→`outreach.comment`, `linkedin_campaign_create`→`campaign.create`, `linkedin_campaign_get`→`campaign.get`, `linkedin_campaign_list`→`campaign.getAll`, `linkedin_campaign_enroll`→`campaign.enroll`, `linkedin_campaign_pause`→`campaign.pause`, `linkedin_campaign_resume`→`campaign.resume`, `linkedin_queue_list`→`queue.list`, `linkedin_queue_approve`→`queue.approve`, `linkedin_queue_reject`→`queue.reject`, `linkedin_research_pack`→`research.pack` (server waits for completion up to 10 min, then returns job id for polling via `linkedin_research_get`→`research.get`), `linkedin_research_resolve`→`research.resolve`, `linkedin_query_sql` (server-local, SQLite), `linkedin_sync` → `sync.pull` into SQLite.

Every write tool accepts `dry_run?: boolean` (default false; the engine additionally queues in Copilot mode). MCP tool input schemas are zod objects mirroring the params above.

MCP resources: `linkedin://status`, `linkedin://profile/{publicId}`, `linkedin://list/{listId}`, `linkedin://queue`.
MCP prompts: `source-candidates` (args: brief, count), `write-opener` (args: publicId, tone), `triage-inbox` (args: since).

### HTTP surface (`lit serve --http`, default `127.0.0.1:47830`)

- `POST /mcp` Streamable HTTP MCP transport (bearer token = bridge token).
- `POST /actions/{action}` JSON body = params, returns the envelope. Used by Node and Python clients and n8n.
- `GET /openapi.json` generated from the action table. `GET /health`.

