# Roadmap

Shipped in phases, one release per phase, tagged and zipped. The public board is the
[GitHub Project](https://github.com/orgs/FormatixAI/projects); this file is the plain-text
version of it.

## Where we are

| Phase | Ships | Status |
|---|---|---|
| **1** | Monorepo, shared action schema, README, release zip, CI, 15 good-first-issues | in progress |
| **2** | Bridge, MCP server (read tools + invite/message/queue), Copilot approval queue in the popup, `lit` CLI, npm publish | in progress |
| **3** | BYOK providers incl. Ollama, opener writer, reply sentiment, six skills, Streamable HTTP + OpenAPI, Node and Python clients with framework wrappers | in progress |
| **4** | Extraction parity — engagers, groups, events, companies, Sales Nav, Recruiter — lists, sequence engine v2 with branching, inbox, webhooks, SQLite sync + SQL tool | planned |
| **5** | Analytics, sequence library, warm-up, enrichment provider interface with a Hunter reference adapter, n8n community node, AutoGen / ADK / Pydantic AI wrappers, docs site | planned |

## Wanted, unscheduled

Ordered by how often people ask, not by how hard they are. All open to contribution — several are
[good first issues](https://github.com/FormatixAI/linkedin-toolkit/labels/good%20first%20issue).

**Automated query-ID refresh (`lit endpoints refresh`).** LinkedIn's GraphQL query IDs carry a
32-hex hash that changes with each web client release, so
[voyager-endpoints.md](voyager-endpoints.md) has to be re-captured by hand today and
`lit endpoints check` only tells you *that* something drifted. `lit endpoints refresh` would fetch
the current LinkedIn JS bundle, scrape the query IDs out of it — they are literal strings in the
bundle — and write the table back with the new hashes, the date and the client version. Near-term,
and the highest-leverage thing on this list: it turns the project's main maintenance burden into a
command.

**Extractors.** Company followers, hashtag followers, newsletter subscribers, threaded post
comments, recommendations, endorsements, saved items, company job postings, alumni search.
[How to add one](build-an-extractor.md) — this is the single most useful thing you can contribute.

**Agent integrations.** Mastra, Haystack, Semantic Kernel, Letta, Flowise, Make. Each is a wrapper
over the same HTTP surface; the [examples](../examples/) show the shape.

**Enrichment adapters.** The provider interface lands in Phase 5 with Hunter as the reference.
Apollo, Dropcontact, Clearbit and Lusha are community contributions — user keys only, off by
default. Anything that routes profile data through a third-party scraping service is out of scope
permanently — it contradicts local-first.

**Firefox.** The extension is MV3 and mostly portable. The service worker lifecycle and the
WebSocket keep-alive are the real work.

**A local model for the whole loop.** Ollama is already a BYOK provider. What is missing is a
tuned prompt set that produces good openers from an 8B model, so the entire system — capture,
scoring, writing — runs with nothing leaving the machine.

**Better sequence analytics.** Per-variant win rates, time-to-accept distributions, and an honest
"this sequence is underperforming, pause it" signal rather than a dashboard.

**A desktop shell.** Some people will never run `npx`. A tray app that starts the server, shows
the queue, and handles pairing would widen the audience considerably.

## Not going to happen

Not because they are hard, but because they break something the project is for.

| | Why not |
|---|---|
| **Cloud sessions / hosted service** | Needs a server holding your LinkedIn session. That is the thing this project exists to avoid. |
| **Headless browser mode** | No Playwright, Puppeteer, or CDP, anywhere, ever. [Why](why-browser-agents-fail-on-linkedin.md). |
| **Proxies, residential IPs, fingerprint spoofing** | Detection evasion. Different project, worse ethics, and it does not even work. |
| **CAPTCHA solving or challenge bypass** | When LinkedIn puts up a wall, we stop. Non-negotiable. |
| **Raising the hard caps** | 100 invites, 150 messages, 500 visits, 1,000 search results a day. Not configurable, by design. |
| **Team dashboards, seats, role permissions** | Needs a backend. Local-first means one machine, one account. |
| **Email sending** | A different product with different deliverability problems. Use the webhooks. |
| **Chrome Web Store listing** | CWS policy forbids third-party ToS violations; a takedown would be public and permanent. Release zip plus load-unpacked instead. |
| **Multi-account management** | Operating accounts you are not signed into is farming, not automation. |
| **Telemetry** | The project should not be able to count its own users. |

## Influencing it

Open a [Discussion](https://github.com/FormatixAI/linkedin-toolkit/discussions) for an idea, an
[Issue](https://github.com/FormatixAI/linkedin-toolkit/issues) for something concrete, and a PR if
you have already built it. Sequences, skills, extractors and agent integrations are merged fastest
because they are additive and self-contained.

The things that get declined are usually not bad ideas — they are good ideas that require a server.
