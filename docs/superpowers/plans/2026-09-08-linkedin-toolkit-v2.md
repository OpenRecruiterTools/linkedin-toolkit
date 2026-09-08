# LinkedIn Toolkit v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the agent-native, local-first, open-source LinkedIn automation layer described in the spec: extension engine with Waalaxy/PhantomBuster parity, MCP server + bridge + CLI + SQLite + webhooks, Node/Python clients with framework wrappers, skills, sequences, examples, docs and launch assets.

**Architecture:** One engine in the Chrome extension service worker handles every action through a shared action schema. The MCP server is a Node process that owns a localhost WebSocket bridge to the extension, exposes tools/resources/prompts over stdio and Streamable HTTP, mirrors data into SQLite, and hosts the `lit` CLI and outbound webhooks. Node and Python client packages talk to the same HTTP endpoint. Skills, sequences, examples and docs are content built on the contract.

**Tech Stack:** Extension: vanilla ES modules, MV3, Vitest with a `chrome` mock. MCP server: TypeScript, `@modelcontextprotocol/sdk`, `ws`, `better-sqlite3`, `commander`, `zod`, Vitest. Node client: TypeScript, `zod`. Python client: `httpx`, `pydantic`, `pytest`, packaged with `pyproject.toml` (hatchling). n8n node: TypeScript per n8n community node template. Repo tooling: npm workspaces, ESLint, Prettier, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-linkedin-toolkit-v2-design.md`

## Global Constraints

- Local-first: no hosted service, no telemetry, nothing leaves the user's machine except LinkedIn calls from their own Chrome.
- Never a headless browser: no Playwright, Puppeteer, or CDP anywhere, including tests and examples.
- No Formatix exposure: no Formatix/Canvas/RecruitClaw names, URLs, keys, or API shapes anywhere.
- No Chrome Web Store: release zip on GitHub Releases only.
- No LinkedIn logo or trademark in icons or branding. The word "LinkedIn" in text is fine.
- Hard caps live in the extension and cannot be raised by any client: 100 invites/day, 150 messages/day, 500 profile visits/day, 1,000 search results/day.
- Copilot mode is the default: agent-originated writes queue for human approval until Autopilot is on.
- No Apify integration. Enrichment is a provider interface only, with Hunter as the reference adapter.
- Bridge: `ws://127.0.0.1:47829`, pairing token, frames as defined in the Contract section.
- MCP tool names, action names, error codes and shapes: exactly as in the Contract section. Do not invent new ones without adding them to `docs/actions.md`.
- Node ≥ 20 for the MCP server and clients. Python ≥ 3.10 for the Python client.
- Extension has no build step and no runtime dependencies.
- Commit after every task with a conventional-commit message; never push.
- All tests run offline. No live LinkedIn calls in any test.

---

## Contract (source of truth: `docs/actions.md`, created in Task A1)

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
| `network.status` | `{ publicIds: string[] }` | `{ statuses: Record<string, 'connected'\|'pending'\|'none'> }` |
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
  queue: { pending: number }; campaigns: { active: number; paused: number } };
type Config = { minDelayMs; maxDelayMs; hourlyCap; dailyInviteCap; dailyMessageCap; dailyVisitCap; dailySearchCap;
  businessHoursOnly: boolean; businessStart: number; businessEnd: number; weekdaysOnly: boolean;
  autopilot: boolean; accountPreset: 'free'|'premium'|'salesnav'|'recruiter'; warmup: { enabled: boolean; startedAt?: number; days: 14 };
  ai: { provider: 'none'|'anthropic'|'openai'|'gemini'|'ollama'|'openai-compatible'; model?: string; baseUrl?: string; apiKey?: string };
  bridge: { enabled: boolean; port: number; token?: string }; webhookUrl?: string };
```

Hard ceilings are clamped in `config.set` regardless of the value requested.

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

---

## File structure

```
package.json                    npm workspaces: extension, mcp-server, clients/node, clients/n8n
.eslintrc.cjs .prettierrc .editorconfig .gitignore
extension/
  manifest.json                 (moved; version 2.0.0; add "alarms","idle" already present; host_permissions unchanged)
  icons/                        (moved)
  src/lib/actions.js            ACTIONS constant, ERROR codes, EVENTS, validateParams(action, params), clampConfig(cfg), HARD_CAPS
  src/lib/template.js           renderTemplate(str, profile) with fallbacks and variants
  src/lib/csv.js                toCsv(rows, columns), fromCsv(text)
  src/lib/storage.js            get/set helpers over chrome.storage.local, IndexedDB profile store
  src/background/index.js       service worker: message router → engine.handle
  src/background/engine.js      handle(action, params, origin) → envelope; wires modules below
  src/background/voyager.js     (moved, extended) all Voyager endpoints
  src/background/quota.js       quotas, business hours, warm-up, backoff, human delay
  src/background/queue.js       approval queue
  src/background/lists.js       lists + members + dedupe + signals
  src/background/campaigns.js   sequence engine v2 with branching
  src/background/inbox.js       threads/messages/sentiment/reply detection
  src/background/ai.js          provider adapters (anthropic, openai, gemini, ollama, openai-compatible)
  src/background/research.js    Research Pack: resolve, gather, signals, pack builder, job runner
  src/background/enrich.js      enrichment provider interface + Hunter reference adapter
  src/background/bridge.js      WebSocket client to MCP server
  src/background/events.js      emit(event, payload) → bridge + chrome.notifications
  src/content/page-inject.js    (moved)
  src/content/linkedin.js       (moved, extended) full-page capture, photo capture, DOM actions
  src/content/linkedin.css      (moved)
  src/popup/popup.html/.js/.css tabs: Dashboard, Lists, Campaigns, Inbox, Queue, Extract, Settings
  src/options/options.html/.js  full settings incl. AI provider and bridge pairing
  tests/                        Vitest with tests/setup.js chrome mock
mcp-server/
  package.json (name linkedin-toolkit-mcp, bin: linkedin-toolkit-mcp, lit)
  src/contract.ts               action table, zod schemas, types (mirror of docs/actions.md)
  src/bridge.ts                 BridgeServer: ws server, pairing, request/response, events
  src/db.ts                     SQLite schema, upsert from sync.pull, readonly query
  src/tools.ts                  MCP tool definitions → bridge calls
  src/resources.ts, src/prompts.ts
  src/server.ts                 stdio entry
  src/http.ts                   Streamable HTTP MCP + /actions + /openapi.json
  src/openapi.ts                generate OpenAPI 3.1 from contract
  src/webhooks.ts               event → POST webhookUrl with retry
  src/cli.ts                    `lit` commands
  src/config.ts                 ~/.linkedin-toolkit/config.json (token, ports, webhookUrl, dbPath)
  tests/                        fake extension client over ws; sqlite seeded tests; cli snapshots
clients/node/                   package linkedin-toolkit: LinkedInToolkit class, toolDefinitions (JSON schema), adapters: openai(), vercelAi(), langchain()
clients/python/                 package linkedin_toolkit: LinkedInToolkit, tools(), integrations: langchain, llama_index, crewai, autogen, google_adk, pydantic_ai, smolagents
clients/n8n/                    n8n-nodes-linkedin-toolkit: LinkedInToolkit node, LinkedInToolkitTrigger node
skills/                         5 skills in Agent Skills format (SKILL.md + resources)
sequences/                      20 JSON sequences + schema.json
examples/                       claude-code/, openai-agents/, vercel-ai/, langchain/, crewai/, n8n/, cli/
docs/                           README assets, actions.md, tools.md, architecture.md, safety.md, agents/*.md, why-browser-agents-fail-on-linkedin.md, build-an-extractor.md, launch/*
.github/                        workflows (ci.yml, release.yml), ISSUE_TEMPLATE, PULL_REQUEST_TEMPLATE, CONTRIBUTING.md, CODE_OF_CONDUCT.md, good-first-issues.md
```

---

## Workstreams and dependencies

- **WS-A Foundation** (sequential, first): monorepo move, contract file, engine refactor with schema validation, test harness. Everything else depends on A.
- **WS-B Extension engine** (after A): voyager endpoints, quota v2, queue, lists, campaigns v2, inbox, AI providers, bridge client, events, capture.
- **WS-C Extension UI** (after A, parallel with B; talks only to action names): popup tabs, options, pairing.
- **WS-D MCP server** (after A, parallel with B/C; talks only to the contract): bridge server, tools, resources, prompts, HTTP, OpenAPI, SQLite, webhooks, CLI.
- **WS-E Clients** (after A; parallel): Node, Python, n8n.
- **WS-F Content** (after A; parallel): skills, sequences, examples, docs, README, launch assets, GitHub templates, CI.
- **WS-G Integration** (after B, C, D): end-to-end fake-extension ↔ server test, release zip, version bump, changelog.

Each workstream is executed by one subagent running its tasks in order with TDD and a commit per task. Parallel workstreams touch disjoint directories.

---

## WS-A: Foundation

### Task A1: Monorepo layout and contract file

**Files:**
- Move: `manifest.json`, `icons/`, `src/` → `extension/`
- Create: `package.json` (workspaces), `.gitignore`, `.editorconfig`, `.prettierrc`, `.eslintrc.cjs`
- Create: `docs/actions.md` (the Contract section above, verbatim, as the living reference)
- Create: `extension/src/lib/actions.js`

**Interfaces produced:**
```js
// extension/src/lib/actions.js
export const ACTIONS = Object.freeze({ STATUS_GET: 'status.get', CONFIG_GET: 'config.get', /* every action in the table */ });
export const ERROR = Object.freeze({ EXTENSION_OFFLINE: 'EXTENSION_OFFLINE', /* every code */ });
export const EVENTS = Object.freeze({ INVITE_ACCEPTED: 'invite_accepted', /* every event */ });
export const HARD_CAPS = Object.freeze({ dailyInviteCap: 100, dailyMessageCap: 150, dailyVisitCap: 500, dailySearchCap: 1000 });
export const DEFAULT_CONFIG = { /* Config with defaults: minDelayMs 8000, maxDelayMs 15000, hourlyCap 20, dailyInviteCap 25, dailyMessageCap 50, dailyVisitCap 100, dailySearchCap 500, businessHoursOnly true, businessStart 9, businessEnd 18, weekdaysOnly true, autopilot false, accountPreset 'free', warmup {enabled:false, days:14}, ai {provider:'none'}, bridge {enabled:false, port:47829} */ };
export function validateParams(action, params) // returns { ok: true } | { ok: false, message }
export function clampConfig(cfg) // applies HARD_CAPS ceilings and type coercion; returns a new Config
export function ok(id, data, rateLimit) / err(id, code, message, extra)
```

- [ ] Step 1: `git mv manifest.json icons src extension/` (create `extension/` first). Update nothing inside yet; verify the extension still loads by checking `extension/manifest.json` paths are relative (they are: `src/...`).
- [ ] Step 2: Create root `package.json`: `{ "name": "linkedin-toolkit-monorepo", "private": true, "workspaces": ["extension","mcp-server","clients/node","clients/n8n"], "scripts": { "test": "npm run test --workspaces --if-present", "lint": "eslint . --ext .js,.ts" } }` and `extension/package.json` with `"type":"module"`, `"scripts":{"test":"vitest run"}`, devDeps `vitest`.
- [ ] Step 3: Write `docs/actions.md` from the Contract section.
- [ ] Step 4: Write failing tests `extension/tests/lib/actions.test.js`: `ACTIONS` contains every action string in docs/actions.md (parse the table from the md file in the test); `validateParams('search.people', {keywords:'x', count: 500})` fails; `clampConfig({dailyInviteCap: 999}).dailyInviteCap === 100`; `clampConfig({}).minDelayMs === 8000`.
- [ ] Step 5: Run `npm test -w extension`, expect failures. Implement `actions.js`. Run again, expect pass.
- [ ] Step 6: Commit `chore: monorepo layout + shared action contract`.

### Task A2: Test harness and engine skeleton

**Files:**
- Create: `extension/tests/setup.js` (in-memory `chrome.storage.local`, `chrome.alarms`, `chrome.runtime`, `chrome.tabs`, `chrome.cookies`, `chrome.notifications`, `chrome.scripting` mocks; `globalThis.fetch` stub), `extension/vitest.config.js`
- Create: `extension/src/background/engine.js`
- Modify: `extension/src/background/index.js` → thin router: `chrome.runtime.onMessage` → `engine.handle(msg.action, msg.params, 'popup')`; alarms → `engine.handle('campaign.tick', {}, 'system')` and bridge reconnect.

**Interfaces produced:**
```js
// engine.js
export async function handle(action, params = {}, origin = 'popup') // → envelope {ok,data,rateLimit} | {ok:false,error}
export function register(action, handlerFn) // handlerFn(params, ctx) → data; ctx = { origin }
```
`handle` validates params via `validateParams`, catches thrown `EngineError(code, message, extra)` into `err()`, wraps unknown errors as `INTERNAL`, and appends `rateLimit` for outreach actions from `quota.snapshot(kind)`.

- [ ] Step 1: Tests: `engine.handle('nope')` → `INVALID_PARAMS`; registered handler returning data → `ok: true`; handler throwing `new EngineError('QUOTA_EXCEEDED','x')` → error envelope with code.
- [ ] Step 2: Implement `EngineError` in `actions.js`, `engine.js`, rewire `index.js` so v1 handlers (`GET_CONFIG`, `EXPORT_PROFILE` …) are registered under the new action names as adapters (`config.get`, `profile.get`, `search.people`, `network.unfollowCount`, `network.unfollowAll`, `outreach.invite`, `outreach.message`, `campaign.*`). Keep old popup working by mapping the old `type` strings to the new actions in one `LEGACY_MAP` inside `index.js` (deleted in WS-C).
- [ ] Step 3: Run tests; commit `refactor: engine with shared action schema and legacy adapters`.

---

## WS-B: Extension engine

Each task: write Vitest tests with recorded Voyager fixtures under `extension/tests/fixtures/voyager/*.json` (hand-written minimal shapes matching real Voyager responses), implement, commit.

### Task B1: quota.js (quota v2, warm-up, presets, backoff, business hours)
Interfaces: `check(kind)` throws `QUOTA_EXCEEDED|OUTSIDE_BUSINESS_HOURS|RATE_LIMITED|CHALLENGE_DETECTED`; `record(kind)`; `snapshot(kind) → RateLimit`; `humanDelay()`; `noteBackoff(status)` (429 → 15 min, 451 → pause until cleared, 999 → 1 h); `clearChallenge()`; presets `{free:{invite:20,message:40,visit:80,search:300}, premium:{25,60,120,500}, salesnav:{30,80,200,800}, recruiter:{40,100,300,1000}}` (per day, still under HARD_CAPS); warm-up multiplies caps by `min(1, 0.2 + 0.8*dayIndex/14)`.
Tests: caps by preset; warm-up day 0 gives 20%; hard cap wins over config; business hours honours weekdaysOnly; 451 blocks all writes until `clearChallenge()`.

### Task B2: voyager.js extensions
Add endpoints (Voyager REST paths, `voyagerFetch` reused): `getCompany`, `getCompanyEmployees`, `getPostEngagers` (reactions + comments via `feed/reactions` and `feed/comments` with `threadUrn`), `getGroupMembers`, `getEventAttendees`, `getConnections` (`relationships/dash/connections`), `getFollowers`, `getConversations`, `getConversationMessages`, `salesNavSearch` (`salesApi/salesApiPeopleSearch` when `source='salesnav'`), `recruiterSearch` (`talent/search` when `source='recruiter'`), `viewProfile` (fires the profile view beacon), `follow`, `likePost`, `commentPost`, `sendInMail`. Each has a `normalize*` returning contract types. Tests parse fixtures to contract shapes and assert `voyagerFetch` is called with the right path and query.

### Task B3: lists.js
Storage key `lists`, `listMembers:{listId}`. Dedupe on `publicId`; `contactedBefore` computed from `actions` log; `signals` from profile facts (`changedJobRecently` if latest experience start < 90 days; `atTargetCompany` if list tag `company:<name>` matches; `engagedWithPost` set by post.engagers import). `importCsv` maps columns `url|linkedin_url|profile`, `first_name`, `last_name`, `company`, `title`. Tests for dedupe, csv import, signals.

### Task B4: queue.js
Storage key `queue`. `enqueue(action, params, origin, profile) → QueueItem`; `approve(ids, edits)` executes via the outreach handlers with `origin:'approved'` (bypasses the queue, not the quotas); `reject`; `list(status)`; emits `queue_item_added`, `queue_item_sent`, `research_progress`, `research_completed`. Rule in engine: outreach writes from origin `mcp|cli|campaign` queue unless `config.autopilot`; popup origin sends directly; `dry_run` returns `{status:'dryRun', wouldSend}` without quota use. Tests for all four origins × autopilot on/off × dry_run.

### Task B5: campaigns.js (sequence engine v2)
Storage `campaigns`, `enrollments:{campaignId}`. Enrollment `{ publicId, stepIndex, path: number[], nextAt, status: 'active'|'done'|'stopped'|'replied'|'accepted', lastActionAt }`. `tick()`: for each active enrollment due, evaluate step: `wait` schedules; `branch` checks `network.status`/`inbox` and picks `then`/`else`; write steps go through the queue rules; variants chosen round-robin per campaign; `stopOnReply` checks inbox since `lastActionAt`. Stats computed from `actions` log. Emits `campaign_step_done`, `campaign_completed`, `invite_accepted`. Tests: linear sequence, branch accepted/not accepted, reply stops, variants rotate, tick respects `nextAt`.

### Task B6: inbox.js
`threads(since, unreadOnly)`, `messages(threadId)`, `detectReplies()` (compares to `lastSeenAt` per thread; emits `reply_received`; classifies via `ai.complete('sentiment')` when configured else keyword fallback `positive` for /interested|sure|yes|let's|call|book/i, `negative` for /not interested|no thanks|remove|stop/i; emits `positive_reply`), `export()`. Tests for reply detection and keyword fallback.

### Task B7: ai.js
`complete(task, input)` → provider adapter → `{output, provider, model}`. Adapters: `anthropic` (`/v1/messages`, model default `claude-sonnet-5`), `openai` (`/v1/chat/completions`, `gpt-5-mini`), `gemini` (`generateContent`, `gemini-2.5-flash`), `ollama` (`/api/chat`, `llama3.1:8b`, baseUrl default `http://127.0.0.1:11434`), `openai-compatible` (baseUrl required). Prompts per task in `ai-prompts.js`: opener (profile facts only, ≤ 300 chars, no invented facts, tone), summary, sentiment (returns `positive|neutral|negative` + `intent`), comment, score (brief + profile → 0-100 + reason). Tests: each adapter builds the right request from a stubbed fetch; `AI_NOT_CONFIGURED` when provider none.

### Task B8: bridge.js + events.js
Bridge client per Bridge protocol; handles requests by calling `engine.handle(action, params, 'mcp')`; sends events. Alarm `bridge-keepalive` every 1 min triggers `ensureConnected()`. `events.emit` also fires `chrome.notifications` for `challenge_detected`, `quota_hit`, `positive_reply`. Tests with a fake `WebSocket` class: hello handshake, 4001 close on bad token, request routing, backoff sequence.

### Task B9: content capture + DOM actions
`linkedin.js`: message handlers `CAPTURE_FULL` (document.body.innerText cleaned, profile photo `<img>` → canvas → data URL, main sections), `DOM_LIKE`, `DOM_COMMENT`, `DOM_FOLLOW` (button selectors with `dispatchEvent`, reuse unfollow pattern). Engine `profile.get {full:true}` opens/uses a tab for the URL, waits for load, sends `CAPTURE_FULL`, merges into Profile. Tests for the text cleaner and the merge; DOM handlers tested with jsdom.

### Task B10a: research.js + enrich.js (Research Pack)
Storage `researchJobs`, `researchPacks:{jobId}`. `resolve(rows)`: URL → publicId; email domain / domain → `company.get`; name+company → `search.people` count 5, pick best by name similarity (normalised Levenshtein ≥ 0.85 and company match) else return candidates with `kind:'unresolved'`. `startPack(rows, opts)` creates a job and processes rows on each `campaign.tick` (max 10 rows per tick, quota-aware, ETA from remaining × average delay). Per row: `profile.get {full}` or `company.get`, recent posts via voyager `getMemberPosts`, mutual connections count via voyager `getMutualConnectionsCount`, signals per spec §5c, optional enrichment via `enrich.js` provider interface (`lookupEmail(profile) → {email?, phone?, provider}`; Hunter reference adapter using user key from config `enrichment: { provider: 'none'|'hunter', apiKey? }`). Builds `markdown` dossier (sections: Summary, Role & Company, Career, Signals, Recent activity, Contact, "Public web" placeholder for the agent, Suggested opener placeholder) and `csvRow`. Adds to list "Research Pack <YYYY-MM-DD>". Emits `research_progress`, `research_completed`. Tests: resolution paths (url, domain, name+company, ambiguous), one row end-to-end with fixtures, ETA maths, quota pause mid-job resumes next tick, Hunter adapter request shape.

### Task B10: export.csv, sync.pull, status.get, config.set
`export.csv` builds CSV via `csv.js` for each kind; `sync.pull` returns everything changed since timestamp (maintain `updatedAt` on every record); `status.get` composes `Status`; `config.set` clamps, persists, emits nothing. Tests for since-filtering and status composition. Commit; WS-B done.

---

## WS-C: Extension UI

### Task C1: Popup shell and Dashboard
`popup.html` with tab bar (Dashboard, Extract, Lists, Campaigns, Inbox, Queue, Settings), `popup.js` using `send(action, params)` helper over `chrome.runtime.sendMessage({action, params})`. Dashboard: connection state (LinkedIn logged in, bridge connected), quotas as bars, Copilot/Autopilot toggle with confirmation, challenge banner with "I've cleared it" button, active campaign summary. Remove `LEGACY_MAP` from `index.js`. No frameworks; small `ui.js` helpers (`el`, `render`).

### Task C2: Extract tab
Buttons for each extraction action with inputs (keywords + source select + count; URL list textarea; post URL + kind; group/event/company URL; connections/followers), progress bar, "save to list" select, "download CSV/JSON". Bulk profile export runs sequentially with progress from engine events.

### Task C3: Lists tab
Create/rename/delete, tags, member table with signals badges and contactedBefore, CSV import (file input), export, "enroll in campaign".

### Task C4: Campaigns tab
Builder: name, step list with add/remove/reorder, per-step editor (note/body with variables helper and variants), wait, branch editor; "load from sequence template" (fetch `sequences/*.json` bundled into `extension/sequences/` by a copy step in CI, at build time just a committed copy); enroll from list; stats view per step; pause/resume/delete.

### Task C5: Inbox and Queue tabs
Inbox: thread list with unread/sentiment, thread view, reply box (goes through `outreach.message`), saved replies (stored in config), snooze. Queue: pending items with profile, preview of note/body, inline edit, approve/reject, approve all.

### Task C5b: Research Pack tab
Drop-zone for CSV (or paste), column mapping preview, options (full capture, enrich, list name), start button, progress with ETA, per-row status table (resolved/unresolved with candidate picker), "download packs" (zip of md+json+csv via `chrome.downloads`), export enriched CSV.

### Task C6: Settings and Options
Settings tab: preset selector, delays, caps (with hard cap shown), business hours, warm-up toggle, AI provider block (provider select, model, base URL, API key, "test" button calling `ai.complete summary` on a dummy), bridge block (enable, port, token paste, connection status), webhook URL. Options page = same form full-width plus "export/import settings JSON" and "danger zone: clear all data". Manual smoke checklist written to `docs/smoke-checklist.md`.

---

## WS-D: MCP server

### Task D1: package scaffold + contract.ts
`mcp-server/package.json` (deps: `@modelcontextprotocol/sdk`, `ws`, `better-sqlite3`, `commander`, `zod`, `zod-to-json-schema`; devDeps `typescript`, `vitest`, `tsx`, `@types/ws`, `@types/better-sqlite3`), `tsconfig.json` (NodeNext, ES2022, strict), `src/contract.ts` with zod schemas for every action's params and the shared types, `ACTIONS` list, `WRITE_ACTIONS` set, error codes. Test: every action in `docs/actions.md` has a schema.

### Task D2: bridge.ts
`class BridgeServer { constructor({port, token}); start(); stop(); isConnected(); request(action, params, {timeoutMs=60000}) → data | throws BridgeError(code,...); on('event', fn) }`. Single active extension connection (newer replaces older). Tests use a fake extension client (`tests/fakeExtension.ts`) that answers requests from a handler map and can emit events.

### Task D3: db.ts
Schema per spec §4.4 with `updated_at`; `upsertSync(payload)` idempotent; `query(sql, params)` allows only a single statement starting with `SELECT` or `WITH`, uses `db.prepare` in readonly connection, 5 s timeout, 1,000 row cap. Tests: upsert twice yields one row; `DELETE` rejected; row cap.

### Task D4: tools.ts + resources.ts + prompts.ts + server.ts
Register every tool from the mapping table with zod input schemas; write tools add `dry_run`; results as `content: [{type:'text', text: JSON.stringify(data)}]` plus `structuredContent`; errors from bridge become `isError` text with the structured error JSON. `linkedin_sync` pulls and upserts; every successful tool call also upserts its returned profiles/threads into SQLite. Resources and prompts per contract. `server.ts` = stdio transport. Tests: tool list matches mapping; a tool call flows through the fake extension; offline → `EXTENSION_OFFLINE` with `howToFix`.

### Task D5: http.ts + openapi.ts
Streamable HTTP MCP at `/mcp` with bearer check; `/actions/{action}`; `/openapi.json` generated from contract (paths per action, schemas from zod via `zod-to-json-schema`, bearer security scheme); `/health`. Tests with `fetch` against an ephemeral port.

### Task D6: webhooks.ts + config.ts
Config at `~/.linkedin-toolkit/config.json` (`{ token, bridgePort, httpPort, webhookUrl, dbPath }`), token generated on first run (32 hex chars) and printed with pairing instructions. Webhooks: on bridge event, POST `{event, payload, at}` with 3 retries (1 s, 5 s, 25 s). Tests with a local receiver.

### Task D7: cli.ts
`commander` program `lit`: `serve [--http] [--port]`, `status`, `search <keywords> [--source] [--count] [--csv <file>] [--json] [--list <name>]`, `profile <url> [--full] [--json]`, `engagers <postUrl> [--kind] [--list]`, `company <url> [--employees]`, `invite <url> [--note]`, `message <url> --body`, `inbox [--since 24h] [--sentiment]`, `queue [approve|reject] [ids...]`, `campaign create --from <file> --list <name>`, `campaign list|pause|resume <id>`, `sql "<query>"`, `export --table <t> --csv <file>`, `sync`, `research <input.csv> [--out ./packs] [--enrich] [--list <name>]` (streams progress, writes `packs/<slug>/pack.md|pack.json` and `packs/output.csv`). Commands connect to the running server's HTTP `/actions` endpoint (start `lit serve` first; `lit` prints a clear message if not running). Snapshot tests for `--help` and `status` output using the fake extension.

---

## WS-E: Clients

### Task E1: clients/node
Package `linkedin-toolkit`: `class LinkedInToolkit({ baseUrl='http://127.0.0.1:47830', token })` with one typed method per action; `toolDefinitions()` → `{ name, description, parameters (JSON schema) }[]` generated from the same zod schemas (copy `contract.ts` via a build script, never diverge); adapters `toOpenAITools(client)`, `toVercelAITools(client)`, `toLangChainTools(client)` (dynamic structured tools). Tests against a mock HTTP server.

### Task E2: clients/python
Package `linkedin-toolkit` (module `linkedin_toolkit`): `LinkedInToolkit(base_url, token)` sync + async via httpx; pydantic models generated from `openapi.json` committed as `linkedin_toolkit/openapi.json`; `tools()` returns list of `{name, description, parameters}`; `integrations/langchain.py` (`StructuredTool`s), `llama_index.py` (`FunctionTool`s), `crewai.py` (`BaseTool` subclasses), `autogen.py` (function registrations), `google_adk.py` (`FunctionTool`s), `pydantic_ai.py` (`Tool`s), `smolagents.py` (`@tool` functions). Each integration import is optional (guarded). Pytest against `respx`. `pyproject.toml` with extras per framework.

### Task E3: clients/n8n
`n8n-nodes-linkedin-toolkit`: credentials (base URL + token), `LinkedInToolkit` node with resource/operation dropdowns mapped to actions, `LinkedInToolkitTrigger` webhook node (user pastes the n8n webhook URL into toolkit settings). Lint with `n8n-node-dev` rules; unit test the parameter → request mapping.

---

## WS-F: Content and launch

### Task F1: Skills (Agent Skills format)
`skills/linkedin-sourcer/SKILL.md`, `skills/linkedin-outreach-writer/SKILL.md`, `skills/linkedin-campaign-runner/SKILL.md`, `skills/linkedin-profile-to-dossier/SKILL.md`, `skills/linkedin-reply-triage/SKILL.md`, `skills/linkedin-research-pack/SKILL.md` (instructs the agent to call `linkedin_research_pack`, then for each pack use its own web search for news/talks/GitHub/podcasts, append a "Public web" section and a suggested opener, and never invent facts). Frontmatter `name`, `description` (trigger phrases), body: when to use, tool sequence with exact tool names, output format, guardrails (facts only, caps, Copilot). `skills/README.md` with install lines for Claude Code (`~/.claude/skills/`) and OpenClaw (`skills/` folder). No Formatix/RecruitClaw text.

### Task F2: Sequences
`sequences/schema.json` (Step/Campaign JSON schema) and 20 sequences: warm-connect, connect-then-message, recruiter-passive-candidate, recruiter-active-candidate, exec-search-confidential, founder-to-founder, sales-post-engager, sales-event-attendee, sales-competitor-follower, sales-job-change-trigger, partnership, investor-intro, podcast-guest, speaker-invite, reactivation-old-connection, referral-ask, hiring-manager-intro, agency-bd, saas-trial-nudge, community-invite. Each with 2 variants per message step and a branch on accepted. Validate all against schema in a test.

### Task F3: Examples
`examples/claude-code/` (transcript md + `.mcp.json`), `examples/openai-agents/` (TS script), `examples/vercel-ai/` (route handler), `examples/langchain/` (py), `examples/crewai/` (py), `examples/n8n/` (workflow JSON with trigger → OpenAI → approve), `examples/cli/` (bash scripts). Each runnable against `lit serve --http` with the fake extension for demo.

### Task F4: Docs
`docs/architecture.md` (with mermaid diagram), `docs/safety.md`, `docs/tools.md` (generated from contract by `mcp-server/scripts/gen-docs.ts`), `docs/agents/{claude-code,claude-desktop,cursor,windsurf,zed,cline,openclaw,codex,gemini-cli,chatgpt-connector,openai-agents,vercel-ai,langchain,llamaindex,crewai,autogen,google-adk,pydantic-ai,smolagents,n8n,dify}.md` each with the one-block config, `docs/agents/quickstart.md` (written for an agent), `docs/why-browser-agents-fail-on-linkedin.md`, `docs/build-an-extractor.md`, `docs/smoke-checklist.md`, `llms.txt`.

### Task F5: README and launch assets
`README.md` per spec §9: hero line, GIF placeholder `docs/assets/demo.gif` (record with `docs/launch/record-demo.md` instructions; ship a static PNG storyboard `docs/assets/demo-storyboard.png` generated with Pillow until the GIF exists), install in 3 lines, price table, browser-agents-vs-toolkit table, feature matrix vs Waalaxy/PhantomBuster/Sales-Mind, architecture diagram, safety, disclaimer, star-history badge, contributors. `docs/launch/show-hn.md`, `docs/launch/blog-post.md`, `docs/launch/linkedin-post.md`, `docs/launch/reddit-posts.md`, `docs/launch/product-hunt.md`, `docs/launch/directories.md` (submission checklist with URLs), `docs/launch/good-first-issues.md` (15 issues with title/body/labels ready for `gh issue create`).

### Task F6: GitHub and CI
`.github/workflows/ci.yml` (node 20/22 matrix: lint, test all workspaces; python 3.10/3.12: pytest), `.github/workflows/release.yml` (on tag `v*`: zip `extension/` → `linkedin-toolkit-extension-vX.zip`, build mcp-server, attach to release; npm publish behind `NPM_TOKEN` secret if present), issue templates (bug, feature, extractor request), PR template, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/FUNDING.yml` (GitHub Sponsors placeholder off), labels file for `good first issue`, `help wanted`, `extractor`.

---

## WS-G: Integration and release

### Task G1: End-to-end test
`mcp-server/tests/e2e.test.ts`: start BridgeServer + HTTP, connect the fake extension loaded with fixtures, run: search → list.add → campaign.create → campaign.enroll → tick → queue.list shows pending → queue.approve → event `queue_item_sent` → webhook received → `linkedin_query_sql` counts profiles. Also Python client smoke against the same server.

### Task G2: Real-extension smoke
Load `extension/` unpacked in Chrome on this machine, run `lit serve --http`, pair, run `lit status`, `lit search "CTO fintech London" --count 10 --json` with Dominic's session **read-only** (search and profile only, no writes), confirm data shape. Document results in `docs/smoke-results-2026-09.md`. No write actions against Dominic's account.

### Task G3: Version, changelog, release prep
Bump extension manifest and packages to `2.0.0`, `CHANGELOG.md`, tag prepared but not pushed. Produce `dist/linkedin-toolkit-extension-v2.0.0.zip` locally. Present the external-actions checklist to Dominic: repo transfer, push, npm publish, PyPI publish, issues seeding, directory submissions.

---

## Self-review

- Spec coverage: §5c Research Pack → B10a/C5b/D4/D7/F1; §2 non-negotiables → Global Constraints; §3 layout → File structure; §4.2 bridge → B8/D2; §4.3 schema → A1/A2; §4.4 data → B3/B10/D3; §4.5 AI → B7/C6; §5 tools → D4; §5b ecosystem → D5/E1/E2/E3/F4; §6 CLI → D7; §7 extraction → B2/B9/C2; lists → B3/C3; outreach → B4/B5/C4; inbox → B6/C5; safety → B1/B4/C1; analytics → B5 stats/C4; integrations → D6/E3; §8 skills → F1; §9 launch → F5/F6; §10 phases collapse into workstreams since all phases are being built now; §11 testing → every task; §12 errors → contract + A2.
- Placeholders: none; each task names files, interfaces, and tests.
- Type consistency: names in Contract are the single source; D1 and E1 copy them mechanically.
