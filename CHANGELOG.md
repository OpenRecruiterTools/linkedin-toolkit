# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.3] — 2026-09-09

### Fixed
- Invitations send through the verified `verifyQuotaAndCreateV2` call (captured live on client 1.13.46516): the missing `decorationId` and the unread `data.value` made every engine send report failure.
- `queue.approve` returns immediately; a queue tick sends approved items with human pacing and emits `queue_item_sent` (#21).
- Quota reservations are handed back when the engine refuses a send itself (invalid params) rather than LinkedIn.

### Added
- Invitation notes are capped at LinkedIn's 200 characters everywhere a note is drafted or validated; skills recommend 180.
- `lit queue list --status pending|approved|sent|failed|rejected`, with the failure reason on failed items.
- `docs/safety.md` explains the monthly personalised-invitation allowance on free accounts.

## [2.0.1] — 2026-09-09

A packaging and documentation release: how the toolkit is found, installed and explained. Nothing
in the server's behaviour or its API contract changed — `openapi.json` and `tools.json` still
report API version `2.0.0`, and no extension code moved.

### Added

- A manifest for the official [MCP Registry](https://registry.modelcontextprotocol.io):
  `server.json` at the repo root, on schema version `2025-12-11`, listing the npm package
  `linkedin-toolkit-mcp` as a stdio server under the name
  `io.github.FormatixAI/linkedin-toolkit`, and the matching `mcpName` field in
  `mcp-server/package.json` — which is how the registry verifies that whoever publishes the
  listing also owns the npm package. `docs/registry-publish.md` is the runbook for doing it with
  the `mcp-publisher` CLI.
- A `Dockerfile`, so the registries and directories that introspect a server by building and
  running it (Glama, the MCP Registry) have something to build.
- `--help` on the server binary: `npx linkedin-toolkit-mcp --help` now explains what the binary
  is, how to wire it into an MCP client, and where the pairing token lives, then prints the `lit`
  usage and exits — instead of starting a bridge and waiting on stdin.
  ([#19](https://github.com/OpenRecruiterTools/linkedin-toolkit/pull/19), thanks
  [@addielaruee](https://github.com/addielaruee))
- A CommonJS entry point for the Node client, so `require('linkedin-toolkit')` works alongside the
  ESM import. ([#18](https://github.com/OpenRecruiterTools/linkedin-toolkit/pull/18), thanks
  [@1cbyc](https://github.com/1cbyc))

### Fixed

- Every repository link in the README and the docs points at
  `OpenRecruiterTools/linkedin-toolkit` and at the `master` default branch, so nothing lands on a
  404 or on a branch that does not exist.
- The lockfile is portable to Linux CI runners: the rollup platform binaries are pinned as
  optional dependencies, and `n8n-workflow` is pinned to `1.120.0`, the last release without the
  `isolated-vm` native build.

### Docs

- `docs/why-browser-agents-fail-on-linkedin.md` gained "The other failure: hard-coded endpoints" —
  why the Voyager endpoints a scraper hard-codes drift out from under it, and what the toolkit
  does instead.

## [2.0.0] — 2026-09

The v2 rebuild: an agent-native, local-first LinkedIn layer. The v1 extension becomes the engine
and stops being the product; everything an agent needs is new. There is still no account, no
server of ours, and no telemetry — the whole thing runs on your machine, in your browser session.

**Breaking.** v1's `chrome.runtime` message shapes are gone. Every caller — the popup, the CLI,
the MCP server, the content scripts — now speaks one contract: `{ action, params }` in,
`{ ok: true, data }` or `{ ok: false, error: { code, message, retryAfter?, howToFix? } }` back.
v1's `usage_*` storage counters are abandoned in favour of the new quota buckets. If you scripted
against v1 internals, nothing you wrote will work.

### Added

**Agent layer**

- `linkedin-toolkit-mcp` — an MCP server over stdio and Streamable HTTP with **39 tools**,
  4 resources (`linkedin://status`, `linkedin://queue`, `linkedin://list/{listId}`,
  `linkedin://profile/{publicId}`) and 3 prompts (`source-candidates`, `write-opener`,
  `triage-inbox`).
- A localhost WebSocket bridge on `127.0.0.1:47829` with token pairing, one live extension at a
  time, and in-flight requests that fail immediately with `EXTENSION_OFFLINE` when Chrome goes
  away rather than hanging until a timeout.
- `POST /actions/{action}` for all 51 actions and `POST /tools/{tool}` for all 39 tools, with a
  generated OpenAPI 3.1 document at `/openapi.json` and `GET /health`. Bound to `127.0.0.1`,
  bearer token, CORS granted only to localhost origins.
- SQLite mirror at `~/.linkedin-toolkit/toolkit.db` and a genuinely read-only `linkedin_query_sql`
  tool: a separate read-only connection, a single `SELECT`/`WITH` statement, a 1,000-row cap and a
  time budget. An agent can work over past captures instead of re-scraping.
- Outbound webhooks for every event, POSTed as `{ event, payload, at }` and retried at 1 s, 5 s
  and 25 s.
- `lit` — a CLI over the same HTTP API: `serve`, `status`, `search`, `profile`, `engagers`,
  `company`, `invite`, `message`, `inbox`, `queue`, `campaign`, `sql`, `export`, `sync`,
  `research`, `config`, `token rotate`.
- `lit serve --fake` — a demo mode with 25 invented profiles, 10 fictional companies, lists,
  campaigns, a queue and research packs. The demo extension attaches over the **real bridge**, so
  a demo run exercises the same path a real one does. No LinkedIn account, no Chrome, no network.
- Node and Python client packages with wrappers for the OpenAI Agents SDK, Vercel AI SDK,
  LangChain, LlamaIndex, CrewAI, AutoGen, Google ADK, Pydantic AI and smolagents.
- `n8n-nodes-linkedin-toolkit` community node with a webhook-fed trigger.

**Extension**

- One shared action schema: the popup, the CLI and the MCP server are clients of one engine, and
  `docs/actions.md` is the contract both sides are tested against.
- **Approval queue with Copilot mode on by default.** Every agent-originated write becomes a
  queued item a human approves, edits or rejects — the note that is sent is the note you last
  edited. Autopilot exists and asks for a confirmation before it turns on.
- Extraction parity with the tools people pay for: people search (plus Sales Navigator and
  Recruiter sources), post engagers, group members, event attendees, company employees,
  connections, followers, and message threads.
- Lists with tags, cross-list dedupe, a `contactedBefore` flag and intent signals.
- Sequence engine v2: branching on accepted / replied / not accepted after N days, A/B variants
  per step, and replies that stop the sequence.
- Unified inbox with reply detection, sentiment tagging, saved replies and snooze.
- Research Pack: rows in; resolved profiles, company, recent posts, mutuals, signals, a Markdown
  dossier and an enriched CSV out, progressing over the event channel so a long job survives the
  popup being closed.
- BYOK provider layer — Anthropic, OpenAI, Gemini, Ollama, any OpenAI-compatible base URL. Keys
  stay in `chrome.storage.local`.
- 14-day sender warm-up and account presets (Free, Premium, Sales Navigator, Recruiter).
- Enrichment provider interface with a reference adapter, off by default.

**Testing and release**

- 1,192 automated tests, all offline: 657 for the extension against an in-memory `chrome` mock,
  295 for the server against a fake extension that speaks the real bridge protocol, 62 for the
  Node client, 51 for the n8n node and 127 for the Python client. No Playwright, no Puppeteer, no
  CDP anywhere in the repository — CI fails the build if one is added.
- End-to-end suites that cross the layers: one process wiring bridge, HTTP, MCP, SQLite and a
  webhook receiver through a whole session; one that spawns the real built `lit` binary and drives
  it with further `lit` processes; and one that installs the Python client into a throwaway
  virtualenv and drives the same server through it.
- `npm run zip:extension` produces `dist/linkedin-toolkit-extension-v2.0.0.zip` with install
  instructions inside it; `npm run release:check` runs the whole gate.
- CI on Node 20 and 22 and Python 3.10 and 3.12, with checks that `openapi.json` and `tools.json`
  are regenerated and that the one native module actually loads.

### Changed

- Repository restructured as an npm workspaces monorepo; the v1 extension moves to `extension/`.
- Repository transferred to `OpenRecruiterTools/linkedin-toolkit` (the old URL redirects).
- Structured errors everywhere, carrying `code`, `message`, `retryAfter` and `howToFix`. Thirteen
  error codes, documented, and the same set on both sides of the bridge.
- Search quota now counts **results, not calls**, against the 1,000/day cap, so a single
  hundred-result page cannot slip through as one unit.
- Business hours are enforced in the quota layer, so they apply to every outreach origin —
  popup, CLI, agent, campaign tick — and not only to campaigns.
- A profile read is metered once and cached for 24 hours, so a campaign invite that needs the
  person's urn and an already-connected pre-check costs one profile view, not two.
- Requests carry an `origin` (`mcp` or `cli`) so the engine can tell an agent-originated write
  from a human one.

### Safety

- **Hard caps live in the extension, below every client, and cannot be raised** by the MCP server,
  the CLI, an agent, or a config file: 100 invitations, 150 messages, 500 profile visits and
  1,000 search results per day.
- A LinkedIn 451 security challenge pauses every write until a human clears it in Chrome. There is
  no retry loop anywhere in the codebase; a 429 backs off and reports how long for.
- `network.status` never invents an acceptance. An invitation that has left the pending list is
  confirmed by one metered profile read before anything is claimed, and when neither the
  invitations collection nor a profile read is available the person is reported `pending` —
  outstanding, unconfirmed — never `connected`.
- Write tools take `dry_run` and preview without sending.
- The bridge and the HTTP API bind to `127.0.0.1` only and require a pairing token; the config
  and runtime files holding it are written `0600`.
- BYOK keys and the bridge token are stored in `chrome.storage.local` and never transmitted.
- No telemetry of any kind. Nothing is sent anywhere except to LinkedIn, from your own browser
  session, and to an AI provider you configured yourself.
- The extension is distributed as an unpacked zip, not through the Chrome Web Store, whose policy
  forbids extensions facilitating third-party terms-of-service violations. What this does with
  your own account is your decision, and `docs/safety.md` states the risk plainly rather than
  burying it.

### Docs

- `docs/actions.md` — the contract: 51 actions, 13 error codes, 11 events, the tool mapping and
  the bridge protocol. The extension's tests and the server's tests both check themselves against
  this file.
- `docs/agents/` — one page per ecosystem with the exact config block, plus a quickstart written
  for an agent to read.
- `docs/why-browser-agents-fail-on-linkedin.md`, `docs/architecture.md`, `docs/safety.md`,
  `docs/tools.md`, `docs/cli.md`, `docs/build-an-extractor.md`, `docs/roadmap.md`.
- `docs/smoke-checklist.md` and `docs/smoke-results-2026-09.md` — the manual run that only a
  browser can do, and the sheet it is recorded on, including the LinkedIn endpoints that still
  need verifying against a live session.
- `docs/release-checklist.md` — the external steps a release needs, with the irreversible ones
  marked.
- Six skills in the Agent Skills format; 20 sequence templates with a JSON Schema and a
  zero-dependency validator; runnable examples for Claude Code, the OpenAI Agents SDK, the Vercel
  AI SDK, LangChain, CrewAI, n8n and the CLI.
- `llms.txt`, a rewritten `README.md`, `CONTRIBUTING.md`, `SECURITY.md` and a code of conduct.

---

## [1.0.0] — 2026-05

The original Chrome extension.

### Added

- Profile export to JSON from profile pages and search results
- Keyword search with paginated CSV export
- Mass unfollow with DOM automation and randomised delays
- Campaign manager: view profile, send invite, send message, wait — with template variables
- Quick actions from the popup
- Rate limiting: configurable jittered delays, hourly caps, daily invite and message quotas, a
  business-hours window, 429 backoff and 451 challenge detection

[2.0.3]: https://github.com/OpenRecruiterTools/linkedin-toolkit/compare/v2.0.1...v2.0.3
[2.0.1]: https://github.com/OpenRecruiterTools/linkedin-toolkit/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/OpenRecruiterTools/linkedin-toolkit/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/OpenRecruiterTools/linkedin-toolkit/releases/tag/v1.0.0
