# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The v2 rebuild: an agent-native, local-first LinkedIn layer. The v1 extension becomes the engine;
everything else is new.

### Added

**Agent layer**
- `linkedin-toolkit-mcp` — an MCP server over stdio and Streamable HTTP with 39 tools, 4 resources
  (`linkedin://status`, `linkedin://queue`, `linkedin://list/{listId}`,
  `linkedin://profile/{publicId}`) and 3 prompts (`source-candidates`, `write-opener`,
  `triage-inbox`)
- A localhost WebSocket bridge on `127.0.0.1:47829` with token pairing
- `POST /actions/{action}` HTTP API with a generated OpenAPI 3.1 document at `/openapi.json`
- SQLite mirror at `~/.linkedin-toolkit/toolkit.db` with a read-only `linkedin_query_sql` tool
- Outbound webhooks for every event
- The `lit` CLI
- Node and Python client packages with wrappers for the OpenAI Agents SDK, Vercel AI SDK,
  LangChain, LlamaIndex, CrewAI, AutoGen, Google ADK, Pydantic AI and smolagents
- `n8n-nodes-linkedin-toolkit` community node with a webhook-fed trigger

**Extension**
- One shared action schema — the popup, the CLI and the MCP server are clients of one engine
- Approval queue with Copilot mode on by default; every agent-originated write waits for a human
- Extraction parity: post engagers, group members, event attendees, company employees and
  followers, connections, followers, message threads, Sales Navigator and Recruiter sources
- Lists with tags, cross-list dedupe, a `contactedBefore` flag and intent signals
- Sequence engine v2: branching on accepted / replied / not accepted after N days, A/B variants
  per step, replies stop the sequence
- Unified inbox with reply detection and sentiment tagging
- Research Pack: rows in, resolved profiles, signals, dossiers and an enriched CSV out
- BYOK provider layer — Anthropic, OpenAI, Gemini, Ollama, any OpenAI-compatible base URL
- 14-day sender warm-up and account presets (Free, Premium, Sales Navigator, Recruiter)
- Enrichment provider interface with a Hunter reference adapter, off by default

**Content**
- Six skills in the Agent Skills format
- 20 sequence templates with a JSON Schema and a zero-dependency validator
- Runnable examples for Claude Code, the OpenAI Agents SDK, the Vercel AI SDK, LangChain, CrewAI,
  n8n and the CLI
- `docs/agents/` — one page per ecosystem with the exact config block, plus a quickstart written
  for an agent to read
- `docs/why-browser-agents-fail-on-linkedin.md`, `docs/architecture.md`, `docs/safety.md`,
  `docs/tools.md`, `docs/build-an-extractor.md`, `docs/roadmap.md`
- `llms.txt`

### Changed

- Repository restructured as an npm workspaces monorepo; the v1 extension moves to `extension/`
- Repository transferred to `FormatixAI/linkedin-toolkit` (the old URL redirects)
- Hard caps are now enforced in the extension below every client and cannot be raised by the MCP
  server, the CLI, an agent, or a config file: 100 invites, 150 messages, 500 profile visits and
  1,000 search results per day
- Structured errors everywhere, carrying `code`, `message`, `retryAfter` and `howToFix`
- A LinkedIn 451 security challenge now pauses every write until a human clears it in Chrome.
  There is no retry loop anywhere in the codebase

### Security

- The bridge and the HTTP API bind to `127.0.0.1` only and require a pairing token
- BYOK keys and the bridge token are stored in `chrome.storage.local` and never transmitted
- No telemetry of any kind

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

[Unreleased]: https://github.com/FormatixAI/linkedin-toolkit/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/FormatixAI/linkedin-toolkit/releases/tag/v1.0.0
