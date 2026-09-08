# Reddit

Five subreddits, five genuinely different posts. Do not cross-post the same text — every one of
these communities can spot it, and two of them will say so in the top comment.

**Rules that apply everywhere:** read the subreddit's self-promotion rules first, several require
you to have comment history there. Post one at a time, days apart. Be in the thread for the first
two hours. Never argue with the ToS comment — agree with it, because it is correct.

---

## r/ClaudeAI

**Title:** I built an MCP server that lets Claude use LinkedIn without getting the account banned

> Browser agents get destroyed on LinkedIn. Headless fingerprints, datacenter IPs, machine-speed
> clicking — it is one of the best-defended sites on the consumer web and browser automation is the
> exact thing it is defended against. I watched an agent burn a real account in twenty minutes.
>
> So this goes the other way. A Chrome extension runs the engine inside the session you are already
> logged into, calling the same internal endpoints the LinkedIn page itself calls. A local Node
> process bridges to it and exposes 39 MCP tools over stdio.
>
> ```json
> { "mcpServers": { "linkedin-toolkit": { "command": "npx", "args": ["-y", "linkedin-toolkit-mcp"] } } }
> ```
>
> Then you can just ask:
>
> > Find me 20 heads of data engineering at Series B fintechs in London, skip anyone I'm already
> > connected to, and draft invites for the top 8.
>
> Claude runs three searches, dedupes, checks connection status, scores against the brief,
> full-captures the finalists, drafts eight notes under 300 characters each hanging on a real fact
> from that person's profile — and **queues all eight for your approval** rather than sending them.
> Copilot mode is the default. There is a full transcript in the repo, tool call by tool call.
>
> The bits I think this sub will care about:
>
> - **Resources and prompts, not just tools.** `linkedin://status`, `linkedin://queue`, plus
>   `/source-candidates`, `/write-opener`, `/triage-inbox` as server-provided slash commands.
> - **Six skills in the Agent Skills format** — sourcing, outreach writing, campaign running,
>   dossiers, reply triage, and a Research Pack skill that has Claude use its *own* web search for
>   news and talks and write them into the dossier with sources.
> - **Structured errors.** `RATE_LIMITED` with `retryAfter`, `CHALLENGE_DETECTED` with
>   instructions, `QUOTA_EXCEEDED` with the actual cap. The model explains what happened instead of
>   retrying into a wall.
> - **Hard caps below the API surface.** 100 invites, 150 messages, 500 profile visits a day,
>   enforced in the extension. Claude cannot raise them and neither can the CLI. This turned out to
>   matter more than any prompt engineering.
>
> MIT, runs entirely on your machine, no telemetry. Also works with Cursor, Windsurf, Zed, Cline,
> OpenClaw, Codex and Gemini CLI, and there are Python and TypeScript wrappers for LangChain,
> CrewAI, the OpenAI Agents SDK and a few others.
>
> [repo] · [why browser agents fail on LinkedIn]
>
> LinkedIn's ToS prohibits automation and this doesn't change that — use your own account.

---

## r/LocalLLaMA

**Title:** LinkedIn automation that runs fully local — MCP server + Ollama, nothing leaves the machine

> Every LinkedIn tool wants your session on their servers and your data through their API. This one
> has no server component at all.
>
> **Architecture:** Chrome extension holds the engine and makes every LinkedIn call from your own
> logged-in session. Local Node process bridges over `ws://127.0.0.1:47829` and exposes MCP over
> stdio, an HTTP action API, and a SQLite mirror at `~/.linkedin-toolkit/toolkit.db`. That is the
> whole system. No cloud, no account, no telemetry — the project cannot count its own users.
>
> **The local model part:** the BYOK provider layer has an Ollama adapter (`llama3.1:8b` default,
> anything you have pulled) used for opener writing, profile summaries, reply sentiment, and
> scoring a list against a brief. Point it at your own Ollama and the entire pipeline — capture,
> scoring, writing — runs on your hardware. Also takes any OpenAI-compatible base URL, so
> llama.cpp, LM Studio, vLLM and text-generation-webui all work.
>
> **Your data is a SQLite file.** Everything you capture mirrors into it, and agents get read-only
> SQL over it — no network, no rate limit, no quota:
>
> ```sql
> SELECT company, COUNT(*) n FROM profiles GROUP BY 1 ORDER BY n DESC LIMIT 20;
> ```
>
> Open the same file in any SQLite tool. It is the export.
>
> **Why not just a browser agent:** it gets banned. There is a long write-up in the repo on the
> actual detection surface — fingerprints, datacenter IPs and where residential proxy capacity
> actually comes from, timing signatures, challenge flows. Short version: fingerprint patching is a
> losing arms race against a server-side model trained on hundreds of millions of real sessions,
> and the timing rhythm is harder to fake than any of it.
>
> No Playwright, Puppeteer or CDP anywhere in the repo, including the tests. MIT.
>
> [repo]

---

## r/selfhosted

**Title:** Self-hosted LinkedIn automation — replaces Waalaxy/PhantomBuster, no cloud, no subscription

> **What it replaces:** Waalaxy (~€70/mo), PhantomBuster (~$69/mo), Sales-Mind (~$99/mo). All three
> run your LinkedIn session on their infrastructure. This runs on yours.
>
> **What it is:** a Chrome MV3 extension plus a local Node process. `npx linkedin-toolkit-mcp`,
> paste a pairing token into the extension once, done. Node ≥ 20, no database to provision, no
> Docker required, no reverse proxy, no domain.
>
> **Storage:** `chrome.storage.local` and IndexedDB in the browser, `~/.linkedin-toolkit/toolkit.db`
> (SQLite) on disk. Back it up by copying one file. Delete it and the data is gone — there is no
> copy anywhere else, because there is nowhere else.
>
> **Features:** profile and search export, Sales Navigator and Recruiter, post likers and
> commenters, group members, event attendees, company employees and followers, connections, message
> threads. Lists with tags and dedupe. Multi-step sequences with branching and A/B variants, 20
> templates included. Unified inbox with reply detection. CSV, JSON and SQLite export.
>
> **Automation hooks:** outbound webhooks (`invite_accepted`, `reply_received`, `positive_reply`,
> `challenge_detected`, and more) plus an importable n8n workflow. HTTP API with a generated
> OpenAPI 3.1 document, so anything that speaks HTTP can drive it.
>
> **The safety story, because this is the bit that actually matters:** hard caps enforced inside the
> extension that no client can raise, human-paced jittered delays, business hours, a 14-day warm-up
> for new accounts, and an approval queue that is on by default. On LinkedIn's security challenge
> it stops dead — there is no retry loop in the codebase.
>
> Not on the Chrome Web Store deliberately: CWS policy forbids extensions facilitating third-party
> ToS violations, and a takedown would silently disable it in everyone's browser. Release zip and
> load-unpacked instead.
>
> MIT. LinkedIn's User Agreement prohibits automation — that is in the README in bold, and it is
> your call.
>
> [repo]

---

## r/sales

**Title:** Free open-source alternative to Waalaxy — runs on your own machine, no subscription

> I got tired of paying a monthly subscription for connection requests on a timer, so I built the
> thing and gave it away.
>
> **It does what the paid tools do:**
>
> - Multi-step sequences: visit → follow → connect with a note → message → follow up, with
>   branching on whether they accepted and A/B variants on every step
> - Replies stop the sequence automatically
> - Lists with tags, dedupe, and a "you've contacted this person before" flag
> - Export post likers and commenters, event attendees, group members, company employees
> - Unified inbox with reply detection and sentiment tagging
> - Per-campaign and per-step stats: sent, accepted, reply rate, positive rate
> - 20 sequence templates: job-change trigger, post engager, competitor follower, event attendee,
>   reactivation, referral ask, and more
>
> **What is genuinely different:**
>
> Everything runs in your own Chrome, in the session you are already logged into. Your LinkedIn
> credentials never touch anyone's server, because there is no server.
>
> And if you use ChatGPT or Claude for work, you can point them at it: "find 20 VPs of Sales at
> Series B SaaS companies in Manchester who changed jobs in the last 90 days and draft openers."
> Every draft lands in an approval queue where you read it, edit it, and approve or bin it. Nothing
> sends without you.
>
> **On getting banned:** it has hard daily caps that nothing can raise, human-paced random delays,
> a business-hours window, and a 14-day warm-up ramp for new accounts. It stops completely if
> LinkedIn throws a security challenge instead of retrying. That is not a guarantee — automating
> LinkedIn is against their terms and always carries risk. Start at 10–15 invites a day and never
> run two tools on one account.
>
> Free, MIT licensed, install is unzip a folder and run one command.
>
> [repo]

---

## r/recruiting

**Title:** Built a free sourcing tool that runs locally — dossiers, sequences, no subscription

> Every sourcing tool wants £60–200 a month and your candidate data on their servers. This one is
> free and keeps everything on your machine.
>
> **For sourcing:**
>
> - Search LinkedIn, Sales Navigator or Recruiter and export to CSV or SQLite, filters preserved
> - Pull everyone who attended an event, is in a group, works at a target company, or engaged with
>   a post
> - Named lists with tags, dedupe across every list, and a flag showing whether you have contacted
>   someone before — which is the mistake that actually costs you credibility
> - Intent signals: changed job in the last 90 days, currently posting, company is hiring
>
> **Research Pack** is the one I would actually sell if I were selling it. Drop in a CSV of names,
> emails or company domains. It resolves each row to a LinkedIn profile (and tells you when it is
> not confident rather than guessing between two people with the same name), captures the full
> profile and company, works out the signals, and writes a one-page dossier per person plus an
> enriched CSV with every original column preserved.
>
> If you use ChatGPT or Claude, the bundled skill has it add a public-web section too — recent
> news, conference talks, podcast appearances, with sources — so you walk into a call knowing
> something the candidate did not put on their profile.
>
> **For outreach:** multi-step sequences with branching, A/B variants per message, replies stop the
> sequence, and 20 templates including separate ones for passive candidates, active candidates and
> confidential executive search.
>
> **The bit I would want to know as a recruiter:** every message an AI drafts waits in an approval
> queue until you read it. The skills are written to forbid inventing anything not in the person's
> profile — no invented mutual connections, no "I saw you spoke at", no guessed tenure. A
> fabricated detail in an outreach message is the one thing a candidate will remember about you.
>
> Free, open source, runs on your laptop. Usual caveat: LinkedIn's terms prohibit automation, so
> keep the volumes sensible and use your own account.
>
> [repo]
