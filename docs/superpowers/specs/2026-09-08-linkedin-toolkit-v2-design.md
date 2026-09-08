# LinkedIn Toolkit v2 — Design Spec

**Date:** 2026-09-08
**Status:** Draft for review
**Owner:** Dominic Gonsalves

## 1. Goal

Turn `linkedin-toolkit` (v1.0.0, a Chrome MV3 extension with export, unfollow, and basic campaigns)
into the reference open-source alternative to Waalaxy, PhantomBuster, and Sales-Mind, and the
first LinkedIn layer built for AI agents.

Tagline: **The open-source LinkedIn automation layer for humans and AI agents.**

Success criteria, in priority order:
1. Developers star and list it: featured in MCP directories, a Show HN that reaches the front page,
   and 1,000+ stars within 90 days of the v2 launch.
2. Recruiters and sales people adopt it as a free Waalaxy replacement.
3. The repo demonstrates Dominic's AI engineering skill to hiring managers: clean architecture,
   agent-native design, safety controls, and documentation.

Audience order: developers and AI builders first, recruiters and growth teams second.

## 2. Non-negotiables

- **Local-first.** Everything runs in the user's own Chrome session and on their machine. No
  hosted service, no cloud sessions, no telemetry. This is the safety story and the privacy story.
- **No Formatix exposure.** Nothing from Canvas, RecruitClaw, or the Sales Agent is copied
  verbatim. Designs are re-implemented generically. No Formatix URLs, keys, branding, or API shapes.
- **No Chrome Web Store.** Distribution is a release zip on GitHub Releases plus load-unpacked
  instructions. CWS policy forbids third-party ToS violations and a takedown would be public.
- **No LinkedIn trademark** in icons, names, or screenshots beyond the descriptive word.
- **Hard caps live in the extension** and cannot be raised by an agent, the CLI, or the MCP server.
- **Copilot by default.** Every write action from an agent lands in an approval queue until the
  user flips Autopilot in the popup.
- **Apify is not integrated.** Enrichment is a pluggable provider interface; Apify contradicts
  the local-first pitch.

## 3. Repository layout

Monorepo under `FormatixAI/linkedin-toolkit` (transferred from `OpenRecruiterTools`, redirect kept).

```
linkedin-toolkit/
  extension/            Chrome MV3 extension (v1 code moves here)
    src/background/     engine: voyager client, quotas, campaigns, bridge client
    src/content/        page capture, DOM automation, overlays
    src/popup/          control panel
    src/options/        settings
    src/lib/            shared action schema, template rendering, csv
  mcp-server/           npm package `linkedin-toolkit-mcp`
    src/server.ts       stdio MCP server (tools below)
    src/bridge.ts       localhost WebSocket bridge to the extension
    src/db.ts           SQLite sync + query
    src/cli.ts          `lit` command-line interface
    src/webhooks.ts     outbound event webhooks
  skills/
    claude-code/        SKILL.md packs
    openclaw/           OpenClaw skill folders (generated from the same source)
  sequences/            20 JSON sequence templates
  examples/             agent transcripts, n8n workflow, CLI scripts
  docs/                 architecture, safety, tool reference, contributing, "build an extractor"
  .github/              issue templates, release workflow, good-first-issue labels
```

No build step for the extension. The MCP server is TypeScript compiled by `tsc`, published to npm,
run with `npx linkedin-toolkit-mcp`.

## 4. Architecture

### 4.1 Components

| Component | Runs where | Responsibility |
|---|---|---|
| Extension engine (service worker) | User's Chrome | All LinkedIn calls, quotas, delays, backoff, campaign scheduling, approval queue |
| Content scripts | LinkedIn tabs | Full-page capture, photo capture, DOM actions (unfollow, like, comment), overlays |
| Popup / Options | Chrome | Human control panel: lists, campaigns, inbox, queue, settings, BYOK |
| MCP server | User's machine (Node) | Exposes tools over stdio to Claude Code, Claude Desktop, Cursor, OpenClaw; hosts the bridge, SQLite, CLI, webhooks |
| Skills | Agent workspace | Task recipes that compose the tools |

### 4.2 Bridge

- MCP server listens on `ws://127.0.0.1:47829`. Port is configurable.
- On first run the server prints a pairing token. The user pastes it into the popup once; it is
  stored in `chrome.storage.local`. Every frame carries the token; mismatches are dropped.
- The extension service worker opens the WebSocket on startup and on every alarm tick, and
  reconnects with exponential backoff. MV3 keeps the worker alive while a socket is active
  (Chrome 116+).
- Frames: request `{ id, action, params }`, response `{ id, ok, data?, error?, rateLimit }`,
  event `{ event, payload }` (accepted, replied, campaign_step_done, quota_hit, challenge).
- The MCP server never opens LinkedIn. If the extension is disconnected, tools return a clear
  error with install instructions.

### 4.3 Shared action schema

One switch in the engine handles the same actions for popup, CLI, and MCP. Actions are namespaced
strings (`profile.get`, `search.people`, `outreach.invite`, `campaign.create`, `list.add`,
`inbox.threads`, `queue.approve`). Params and results are JSON-schema documented in
`docs/actions.md` and validated at the boundary. Popup and MCP are two clients of one engine.

### 4.4 Data

- Extension: `chrome.storage.local` for config, quotas, lists, campaigns, queue, inbox cache.
  IndexedDB for profile bodies and photos (storage.local has a size ceiling).
- MCP server: `~/.linkedin-toolkit/toolkit.db` (SQLite via `better-sqlite3`). Tables: profiles,
  companies, searches, search_results, lists, list_members, campaigns, enrollments, actions,
  conversations, messages, events. The server pulls from the extension on every action and on a
  periodic `sync` and exposes `linkedin_query_sql` (read-only, `SELECT` only).
- Export: CSV and JSON from popup and CLI; SQLite file is itself the export for developers.

### 4.5 AI

Two layers, both optional:

1. **Agent-native (headline).** MCP tools and skills. No keys required; the user's agent is the
   brain.
2. **BYOK in the popup.** Provider interface with adapters for Anthropic, OpenAI, Google Gemini,
   Ollama, and any OpenAI-compatible base URL. Used for: opener writing, profile summary,
   reply sentiment and intent classification, auto-comment drafting, list scoring against a brief.
   Keys stored in `chrome.storage.local` only. Ollama default model `llama3.1:8b`.

## 5. MCP tool surface

Read tools:
- `linkedin_search_people` — keywords, title, company, location, source (`search` | `salesnav` |
  `recruiter`), count ≤ 100. Returns normalised profiles.
- `linkedin_get_profile` — url or public id; `full: true` adds page text and photo via capture.
- `linkedin_get_company` — company page, employees list (paged).
- `linkedin_get_post_engagers` — likers and commenters for a post URL.
- `linkedin_get_group_members`, `linkedin_get_event_attendees` — paged.
- `linkedin_get_connection_status` — one or many.
- `linkedin_get_conversations` — threads and messages since a timestamp.
- `linkedin_get_status` — quotas, business hours, backoff, queue length, campaign summaries.
- `linkedin_query_sql` — read-only SQL over the local SQLite.
- `linkedin_list_get` / `linkedin_list_members`.

Write tools (all honour Copilot mode and hard caps):
- `linkedin_view_profile`, `linkedin_follow`, `linkedin_like_post`, `linkedin_comment_post`.
- `linkedin_send_invite` (note optional), `linkedin_send_message`, `linkedin_send_inmail`.
- `linkedin_list_create`, `linkedin_list_add`.
- `linkedin_campaign_create` (steps JSON), `linkedin_campaign_enroll`, `linkedin_campaign_pause`,
  `linkedin_campaign_resume`.
- `linkedin_queue_list`, `linkedin_queue_approve`, `linkedin_queue_reject` — so an agent can
  show the human the queue, but approval is a human action in the popup unless Autopilot is on.

Every write tool accepts `dry_run` and returns what would have been sent. Every tool returns
`rateLimit: { hourlyUsed, hourlyCap, dailyUsed, dailyCap, nextAllowedAt }`.

## 6. CLI

`npx linkedin-toolkit-mcp` starts the server. `lit` is a sibling binary in the same package:

```
lit status
lit search "CTO fintech London" --source salesnav --count 100 --csv out.csv
lit profile https://www.linkedin.com/in/... --full --json
lit engagers <post-url> --list "Post engagers 8 Sep"
lit invite <profile-url> --note "..."          # queues in Copilot mode
lit campaign create --from sequences/warm-connect.json --list "..."
lit inbox --since 24h --sentiment
lit sql "select company, count(*) from profiles group by 1 order by 2 desc limit 20"
lit export --table profiles --csv
```

## 7. Extension feature set (parity layer)

### Extraction
- Profile export JSON/CSV, single and bulk from URL list; full-page capture and photo (ported
  capture design).
- Search export: LinkedIn search, Sales Navigator, Recruiter, filters preserved from URL.
- Post engagers export (likers, commenters).
- Group members, event attendees, company employees, company followers.
- My connections and followers export.
- Message thread export.
- Enrichment providers (off by default, user keys): Hunter, Apollo, Dropcontact. Interface only
  in Phase 4; adapters as community contributions with Hunter as the reference.

### Lists and CRM
- Named lists, tags, dedupe across lists, "contacted before" flag on every profile.
- Import from search, Sales Nav, post engagers, CSV.
- Intent signals: engaged with post, changed job in last 90 days, at target company.
- CSV export with history.

### Outreach engine
- Sequence steps: visit, follow, connect (note), message, InMail, like recent post, comment,
  wait, branch on accepted / replied / not accepted after N days.
- Variables with fallbacks (`{{firstName|there}}`), A/B variants per step.
- Reply stops the sequence. Accepted advances the branch.
- 20 sequence templates in `sequences/`.
- Auto-actions: profile visitor, auto-follow, auto-like, auto-comment (BYOK).

### Inbox
- Unified threads, unread, reply detection, sentiment tag (BYOK or keyword fallback), saved
  replies, snooze, "book a call" link insertion.

### Safety
- v1 rate engine plus: sender warm-up schedule (ramps caps over 14 days), account presets
  (Free, Premium, Sales Nav, Recruiter), Copilot / Autopilot toggle, approval queue with one-click
  approve, edit, reject, challenge (451) and rate-limit (429) auto-pause with notification.
- Hard ceilings regardless of settings: 100 invites/day, 150 messages/day, 500 profile
  visits/day, 1,000 search results/day.

### Analytics
- Per campaign and per step: sent, accepted, replied, reply rate, positive rate. Exportable.

### Integrations
- Outbound webhooks (MCP server): `invite_accepted`, `reply_received`, `positive_reply`,
  `campaign_completed`, `quota_hit`, `challenge_detected`. Example n8n workflow in `examples/`.
- CSV and SQLite for everything else. No Zapier tier, no CRM SDKs.

### Not built
- Cloud sessions, team dashboards, role permissions, white-label, email sending. These need
  servers or contradict local-first.

## 8. Skills

Source of truth is `skills/src/<name>/` with a `skill.md` and metadata; a script generates the
Claude Code `SKILL.md` and the OpenClaw folder. Initial packs (ported and generalised from the
RecruitClaw designs, no RecruitClaw text or branding):

- `linkedin-sourcer` — role or ICP brief → searches → dedupe → score → shortlist CSV and list.
- `linkedin-outreach-writer` — profile facts → opener; tone presets; hard rule: only facts
  present in the profile, no invented details.
- `linkedin-campaign-runner` — build sequence from a template, enroll a list, monitor, report.
- `linkedin-profile-to-dossier` — profile plus web search → one-page brief.
- `linkedin-reply-triage` — classify inbox, propose replies, surface meetings to book.

Each skill has an `examples/` transcript showing the real agent run.

## 9. Launch and distribution

Every phase ends with a tagged release, a GIF, and a post. Assets live in `docs/launch/`.

- README: GIF at top, 3-line install, comparison table (Waalaxy £, PhantomBuster £, Sales-Mind £,
  this £0), architecture diagram, safety section, "why I built this" link, star-history badge.
- MCP directories: Smithery, Glama, PulseMCP, mcp.so, awesome-mcp-servers PR, Cursor directory.
- Alternative listings: alternativeto.net, opensourcealternative.to, awesome-selfhosted PR.
- Posts: Show HN (Phase 2), r/ClaudeAI, r/LocalLLaMA (Ollama angle, Phase 3), r/selfhosted,
  r/sales, r/recruiting, LinkedIn (Dominic's network), X. Product Hunt at Phase 4.
- Contributor funnel: 15 good-first-issues seeded at Phase 1, public roadmap as a GitHub
  Project, Discussions enabled, `docs/build-an-extractor.md` guide, CONTRIBUTING.md,
  all-contributors bot.
- Blog post "Why I open-sourced a Waalaxy alternative" on dev.to and LinkedIn at Phase 2.

## 10. Phases

Each phase is its own implementation plan. Target one phase per week.

| Phase | Deliverable | Launch action |
|---|---|---|
| 1 | Monorepo restructure, transfer to FormatixAI, shared action schema, new README + GIF + comparison table, release v1.1 zip, good-first-issues, CI for lint/tests | LinkedIn + X post; listings prepared |
| 2 | Bridge, MCP server with read tools + invite/message + queue, Copilot approval queue in popup, CLI, npm publish | Show HN; MCP directory submissions; blog post |
| 3 | BYOK provider layer incl. Ollama, opener writer, reply sentiment; 5 skill packs; examples | r/LocalLLaMA, r/ClaudeAI, Cursor directory |
| 4 | Extraction parity (engagers, groups, events, companies, Sales Nav, Recruiter), lists, sequence engine v2 with branching, inbox, webhooks, SQLite sync + SQL tool | Product Hunt; r/selfhosted; alternative listings |
| 5 | Analytics, sequence library, warm-up, enrichment provider interface + Hunter adapter, polish, docs site | Follow-up posts; awesome-selfhosted PR |

## 11. Testing

- Extension: unit tests for the engine (quotas, backoff, template rendering, sequence branching,
  schema validation) with Vitest and a mocked `chrome.*` API. Voyager client tested against
  recorded fixtures; no live LinkedIn in CI.
- MCP server: unit tests for tool handlers with a fake bridge; integration test that spins up the
  bridge and a fake extension client over WebSocket; SQL tool tested against a seeded SQLite.
- CLI: snapshot tests of output.
- Manual: a documented smoke checklist run against a throwaway LinkedIn account before each
  release. Never against Dominic's own account.

## 12. Error handling

- Extension disconnected: MCP tools return `EXTENSION_OFFLINE` with steps.
- LinkedIn 429: engine backs off per v1 rules; tools return `RATE_LIMITED` with `nextAllowedAt`.
- LinkedIn 451 challenge: all writes pause, popup and webhook notify, tools return
  `CHALLENGE_DETECTED`, nothing resumes until the user clears it manually.
- Cap exceeded: `QUOTA_EXCEEDED`, never partial silent truncation; the agent gets the cap number.
- Copilot mode: writes return `QUEUED` with a queue id, not `ok: true`.

## 13. Open decisions (made, recorded here)

- Name stays `linkedin-toolkit`; repo transfers to `FormatixAI`.
- Bridge is localhost WebSocket, not native messaging.
- SQLite lives in the MCP server, not the extension.
- Enrichment providers are user-key adapters; none enabled by default; Apify excluded.
- The Canvas dashboard and Formatix Sales Agent are out of scope; candidate for a separate
  showcase repo later.
