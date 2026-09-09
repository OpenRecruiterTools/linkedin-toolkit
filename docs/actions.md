# Action Contract

This file is the source of truth for the LinkedIn Toolkit v2 contract. Every layer — the extension engine, the popup, the localhost bridge, the MCP server, the `lit` CLI, the Node and Python clients and the n8n nodes — speaks exactly these action names, parameter shapes, result shapes, error codes and event names. The runtime constants (`ACTIONS`, `ERROR`, `EVENTS`, `HARD_CAPS`, `DEFAULT_CONFIG`) live in `extension/src/lib/actions.js` and must stay in lockstep with the tables below; a new action, error code or event is only real once it is added here. Hard caps are enforced in the extension and cannot be raised by any client.

### Action names (engine switch, popup, bridge, CLI, clients all use these)

| Action | Params | Result `data` |
|---|---|---|
| `status.get` | `{ verify?: boolean, postUrl?: string }` | `Status`. With `verify: true` it also runs a read-only pass over every LinkedIn endpoint the engine depends on and adds `endpoints: Record<string, 'ok'\|'failed'\|'unverified'\|'skipped'>`, `clientVersionCaptured`, `endpointsCapturedAt` and, when anything failed, `endpointErrors`. `postUrl` gives the reactions check a post to count likes on; without one that row is `skipped`. The pass costs one search result and one profile visit, metered as usual; see [`voyager-endpoints.md`](voyager-endpoints.md) |
| `config.get` | `{}` | `Config` — for every origin but `popup`, `ai.apiKey`, `enrichment.apiKey` and `bridge.token` come back as `****` plus their last four characters, or are omitted when unset |
| `config.set` | `Partial<Config>` | `Config` — non-popup origins may only set `webhookUrl`; other keys are ignored and listed in `ignoredKeys` |
| `search.people` | `{ keywords, title?, company?, location?, source?: 'search'\|'salesnav'\|'recruiter', start?, count? }` (count ≤ 100) | `{ profiles: Profile[], total?: number, nextStart?: number }` |
| `profile.get` | `{ url?: string, publicId?: string, full?: boolean }` | `Profile` (with `pageText`, `photoDataUrl` when full) |
| `profile.export` | `{ urls: string[], full?: boolean }` | `{ profiles: Profile[], failed: {url, error}[] }` |
| `company.get` | `{ url?: string, universalName?: string }` | `Company` |
| `company.employees` | `{ universalName, start?, count? }` | `{ profiles: Profile[], nextStart? }` |
| `post.engagers` | `{ postUrl, kind: 'likes'\|'comments'\|'both', start?, count? }` | `{ engagers: Engager[], nextStart?, unavailable?: string[] }` — reactions are read from a verified endpoint; comments are not, so `kind: 'comments'` fails with `LINKEDIN_ERROR` and `kind: 'both'` returns the reactions it did read and lists `'comments'` in `unavailable` |
| `group.members` | `{ groupUrl, start?, count? }` | `{ profiles: Profile[], nextStart? }` |
| `event.attendees` | `{ eventUrl, start?, count? }` | `{ profiles: Profile[], nextStart? }` |
| `network.connections` | `{ start?, count? }` | `{ profiles: Profile[], nextStart? }` |
| `network.followers` | `{ start?, count? }` | `{ profiles: Profile[], nextStart? }` |
| `network.status` | `{ publicIds: string[] }` (≤ 25) | `{ statuses: Record<string, 'connected'\|'pending'\|'none'>, partial?: boolean, reason?: string }` |
| `network.unfollowCount` | `{ mode?: 'api'\|'dom' }` | `{ count: number, sample?: string[] }` — popup only; any other origin gets `UNAUTHORIZED`. In the default `api` mode `count` is `totalResultCount` from the following-list read and no tab is opened; in `dom` mode it is read from the following page's own header ("You are following 785 people out of your network"), falling back to the rows currently loaded when that line is absent. `sample` is the first 10 names |
| `network.unfollowAll` | `{ limit?: number, dryRun?: boolean, mode?: 'api'\|'dom' }` | `{ unfollowed: number, attempted: number, names: string[], stopped?: 'limit'\|'end'\|'error'\|'cancelled', error?: string }` — popup only; any other origin gets `UNAUTHORIZED`. `limit` is 1–5000 and stops the run after that many *successful* unfollows; omit it to work through the whole list. `dryRun: true` walks the same list by the same route and unfollows nobody, returning in `names` the people it would have unfollowed (`unfollowed` and `attempted` are then `0`). `attempted` counts every unfollow tried, so `attempted - unfollowed` is how many did not take. `mode` picks how: `api` (the default) pages the following list and POSTs a `followingStates` patch per person with a randomised 0.8–1.6 s pause, needing no tab; `dom` drives the active tab, clicking the page with 2–5 s gaps. No quota bucket is charged either way, but the challenge latch still applies. `stopped` says why the run ended: `limit` (your number was reached), `end` (the list ran out), `cancelled` (`network.unfollowStop`) or `error` (`api`: LinkedIn answered 401/403/429/451, or failed twice in a row; `dom`: the tab navigated away, was closed, or LinkedIn showed a checkpoint — `error` carries the sentence) |
| `network.unfollowStop` | `{}` | `{ stopping: boolean }` — popup only; any other origin gets `UNAUTHORIZED`. Asks the run in flight to stop between people; what is already unfollowed stays unfollowed. `stopping` is `false` when nothing was running, and no flag is left set for a later run to trip over |
| `network.unfollowStatus` | `{}` | `{ running: boolean, done: number, total: number, lastName: string }` — popup only; any other origin gets `UNAUTHORIZED`. What a progress line needs while `network.unfollowAll` is in flight: `total` is the size of the following list as LinkedIn last reported it (`0` before the first page lands), `lastName` the person most recently unfollowed. Poll it alongside the `unfollow_progress` event, which only fires every 10 |
| `outreach.view` | `{ publicId }` | `WriteResult` |
| `outreach.follow` | `{ publicId }` | `WriteResult` |
| `outreach.invite` | `{ publicId, note? }` | `WriteResult` — `note` is at most **200 characters**, LinkedIn's own limit; a longer one is refused with `INVALID_PARAMS` and `howToFix: 'LinkedIn limits invitation notes to 200 characters.'` before any quota is spent, and a campaign step whose rendered note overruns is truncated at a word boundary with a `campaign_note_truncated` event rather than failing. Free accounts also get only a small monthly allowance of personalised (with-note) invitations; exhausting it comes back as `LINKEDIN_ERROR` |
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
| `queue.list` | `{ status?: 'pending'\|'approved'\|'rejected'\|'sent'\|'failed' }` | `{ items: QueueItem[] }` — a `failed` item carries `result.error` |
| `queue.approve` | `{ ids: string[], edits?: Record<id, {note?, body?, subject?}> }` | `{ approved: number }` — **returns immediately**: `approved` is how many were *marked* approved, not how many sent. The extension then sends them one at a time at human pace, on a one-minute alarm plus an immediate kick, emitting `queue_item_sent` per success and marking the rest `failed` with their error; watch those events or poll `queue.list`. Edits are validated against the action's own params first, so an over-long note is refused with `INVALID_PARAMS` and *nothing* is approved. Origin `mcp` is refused with `UNAUTHORIZED` unless `autopilot` is on; `popup` and `cli` are a human deciding and always pass |
| `queue.reject` | `{ ids: string[] }` | `{ rejected: number }` — same origin rule as `queue.approve` |
| `ai.complete` | `{ task: 'opener'\|'summary'\|'sentiment'\|'comment'\|'score', input: object }` | `{ output: string \| object, provider, model }` |
| `export.csv` | `{ kind: 'profiles'\|'list'\|'campaign'\|'inbox', id? }` | `{ csv: string, filename }` |
| `research.resolve` | `{ rows: ResearchRow[] }` | `{ resolved: ResolvedRow[] }` — a row that names a person resolves to `kind: 'person'` or to `'unresolved'`, never to their employer's page. Confidence is `1` for a LinkedIn URL, `1` for a near-exact name whose company or headline agrees, `0.85` for a near-exact name alone; two plausible namesakes come back `'unresolved'` with both in `candidates`. `kind: 'company'` is only for rows with no name |
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

Safety settings belong to the human. From any origin but `popup`, `config.set` silently drops `autopilot`, `clearChallenge`, `bridge`, `ai`, `enrichment`, `accountPreset`, `warmup`, `businessHoursOnly`, `businessStart`, `businessEnd`, `weekdaysOnly`, `minDelayMs`, `maxDelayMs`, `hourlyCap`, `dailyInviteCap`, `dailyMessageCap`, `dailyVisitCap` and `dailySearchCap`, and names them in `ignoredKeys` on the result — leaving `webhookUrl` as the one key an agent may write.

Every profile fetch — `profile.get`, each row of `profile.export`, a connection check, the urn resolution before a message — is metered against the `visit` bucket and paced, because that is what LinkedIn records as a profile visit. One visit is one read of the profile itself; the profile-section reads that follow it (experience always, education and skills on `full: true`) are page-component queries rather than profile views and are not metered.

`Profile.experience` comes from that section read. LinkedIn serves no positions on any profile decoration any more, so a profile whose section read fails comes back with `experience`, `education` and `skills` empty rather than guessed at — see [`voyager-endpoints.md`](voyager-endpoints.md). `network.status` takes at most 25 publicIds per call and answers from the sent-invitations collection wherever it can, spending a visit only for somebody never invited.

`hourlyCap` is additionally clamped to a ceiling of 50 and paces the `invite`, `message` and `visit` buckets only; `search` is metered in results per day, not per hour.

`Campaign.settings.autopilot` is **reserved**. It is stored and returned as part of the campaign, defaults to `false`, and is not read by the engine: whether a campaign step queues or sends is decided solely by the global `Config.autopilot`, which only the popup can change. Do not treat a campaign-level `autopilot: true` as permission to send.

`export.csv` reads its rows from the engine's own stores (`kind: 'profiles'` from the profile store, `'list'` from list members, `'campaign'` from enrollments and the action log, `'inbox'` from stored threads); `kind: 'profiles'` also accepts an optional `profiles: Profile[]` override, which the popup uses to download an ad-hoc result set it already holds, and an optional `download: boolean` that additionally hands the CSV to `chrome.downloads` as a `data:` URL for callers (the popup, the content script) that cannot download for themselves.

### Envelope and errors

Request `{ id: string, action: string, params: object }`.
Response `{ id, ok: true, data, rateLimit? } | { id, ok: false, error: { code, message, retryAfter?, howToFix? } }`.
Event (extension → server) `{ event: EventName, payload }`.

Error codes: `EXTENSION_OFFLINE`, `NOT_LOGGED_IN`, `RATE_LIMITED`, `CHALLENGE_DETECTED`, `QUOTA_EXCEEDED`, `OUTSIDE_BUSINESS_HOURS`, `INVALID_PARAMS`, `NOT_FOUND`, `LINKEDIN_ERROR`, `AI_NOT_CONFIGURED`, `AI_ERROR`, `UNAUTHORIZED` (bad bridge token), `INTERNAL`.

Event names: `invite_accepted`, `reply_received`, `positive_reply`, `campaign_step_done`, `campaign_completed`, `quota_hit`, `challenge_detected`, `queue_item_added`, `queue_item_sent`, `campaign_note_truncated`, `research_progress`, `research_completed`, `unfollow_progress`.

`unfollow_progress` carries `{ done, total }` and is emitted by `network.unfollowAll` every 10 successful unfollows — never during a `dryRun`. It is a heartbeat for a long run, not a per-person feed; poll `network.unfollowStatus` for the ten in between and for the name.

`campaign_note_truncated` carries `{ campaignId, publicId, stepIndex, originalLength, limit, note }`: a campaign invite step whose rendered note came out longer than the 200-character limit was cut at a word boundary and sent, rather than failing that one person. Shorten the template.

### Bridge protocol

- Server: WebSocket on `127.0.0.1:47829`. First frame from extension must be `{ type: 'hello', token, extensionVersion }`; server replies `{ type: 'hello_ok', serverVersion }` or closes with code 4001 (`UNAUTHORIZED`).
- Thereafter server sends requests, extension sends responses and events, per the envelope above. Every 20 s the server sends both a protocol ping — which the browser answers natively, keeping the socket alive — and a `{ type: 'ping' }` message, which the extension answers with `{ type: 'pong' }`. The second one exists because only running JavaScript resets the MV3 service worker's idle timer; a frame the browser answers for it does not. The server ignores every `type` frame the extension sends back.
- Extension reconnects with backoff 1 s → 2 s → 4 s → … → 60 s, reset on success. Reconnect on `chrome.runtime.onStartup`, `onInstalled`, and every alarm tick.
- A request frame may carry an optional `origin: 'mcp' | 'cli'` naming who asked, so the engine can tell an agent-originated write from a human one; a frame without it keeps the engine's existing default.

### MCP tool names → actions

`linkedin_get_status`→`status.get`, `linkedin_endpoints_check`→`status.get` with `verify: true`, `linkedin_search_people`→`search.people`, `linkedin_get_profile`→`profile.get`, `linkedin_export_profiles`→`profile.export`, `linkedin_get_company`→`company.get`, `linkedin_get_company_employees`→`company.employees`, `linkedin_get_post_engagers`→`post.engagers`, `linkedin_get_group_members`→`group.members`, `linkedin_get_event_attendees`→`event.attendees`, `linkedin_get_connections`→`network.connections`, `linkedin_get_connection_status`→`network.status`, `linkedin_get_conversations`→`inbox.threads`, `linkedin_get_messages`→`inbox.messages`, `linkedin_list_create`→`list.create`, `linkedin_list_get`→`list.get`, `linkedin_list_all`→`list.getAll`, `linkedin_list_add`→`list.add`, `linkedin_list_members`→`list.members`, `linkedin_view_profile`→`outreach.view`, `linkedin_follow`→`outreach.follow`, `linkedin_send_invite`→`outreach.invite`, `linkedin_send_message`→`outreach.message`, `linkedin_send_inmail`→`outreach.inmail`, `linkedin_like_post`→`outreach.like`, `linkedin_comment_post`→`outreach.comment`, `linkedin_campaign_create`→`campaign.create`, `linkedin_campaign_get`→`campaign.get`, `linkedin_campaign_list`→`campaign.getAll`, `linkedin_campaign_enroll`→`campaign.enroll`, `linkedin_campaign_pause`→`campaign.pause`, `linkedin_campaign_resume`→`campaign.resume`, `linkedin_queue_list`→`queue.list`, `linkedin_queue_approve`→`queue.approve`, `linkedin_queue_reject`→`queue.reject`, `linkedin_research_pack`→`research.pack` (server waits for completion up to 10 min, then returns job id for polling via `linkedin_research_get`→`research.get`), `linkedin_research_resolve`→`research.resolve`, `linkedin_query_sql` (server-local, SQLite), `linkedin_sync` → `sync.pull` into SQLite.

Every write tool accepts `dry_run?: boolean` (default false; the engine additionally queues in Copilot mode). MCP tool input schemas are zod objects mirroring the params above.

MCP resources: `linkedin://status`, `linkedin://profile/{publicId}`, `linkedin://list/{listId}`, `linkedin://queue`.
MCP prompts: `source-candidates` (args: brief, count), `write-opener` (args: publicId, tone), `triage-inbox` (args: since).

### HTTP surface (`lit serve --http`, default `127.0.0.1:47830`)

- `POST /mcp` Streamable HTTP MCP transport (bearer token = bridge token).
- `POST /actions/{action}` JSON body = params, returns the envelope. Used by Node and Python clients and n8n.
- `GET /openapi.json` generated from the action table. `GET /health`.

