# Why I open-sourced a Waalaxy alternative

*For dev.to, Hashnode, and a LinkedIn article. ~1,230 words.*

---

Waalaxy Pro is about €70 a month. PhantomBuster starts near $69. Sales-Mind is around $99. For
that you get a browser extension or a cloud runner, a sequence builder, and a dashboard.

I built the same thing, gave it away under MIT, and made it work with AI agents. This is why.

## The moment it stopped making sense

I was watching an AI agent try to source candidates on LinkedIn. Not a script — a proper browser
agent, the kind that takes a screenshot, reasons about it, and clicks.

It worked. For about twenty minutes. Then the search results thinned out. Then a checkpoint page
appeared. Then the account — a real one, belonging to a real person, with a real professional
network attached to it — was restricted.

That is not a bug in the agent. LinkedIn is one of the most aggressively defended consumer web
properties in existence, and browser automation is precisely the thing it is defended against.
Headless fingerprints, datacenter IPs, machine-speed clicks: each one is a weak signal, and
combined into a single server-side score they are decisive.

Meanwhile the paid tools *do* work, and the reason is not that they are cleverer. It is that most
of them run in your actual browser, in your actual session. Which raised an obvious question: if
the hard part is solved by "run inside the user's own Chrome", why is that worth €70 a month, and
why can't my agent use it?

## Three things I wanted that nobody sold

**1. My session on my machine.** Cloud automation tools hold your LinkedIn session on their
servers. That is a single, permanent, well-catalogued store of professional identities, and every
month it exists is another month it might leak. I did not want mine in it.

**2. An API my agent could actually use.** Every one of these tools is a UI first. Some have an
API bolted on for enterprise plans. None of them was designed so that Claude or Cursor could say
"find twenty heads of data engineering at Series B fintechs in London, skip anyone I already know,
and draft invites for the top eight" and have it just work.

**3. Safety controls the agent cannot reach.** This is the part I care most about. If an agent can
call an API, it can call it a thousand times. Rate limits in a UI are a suggestion; rate limits
that live below the API surface are a guarantee.

Nobody was selling all three, and the third one is not a feature you can add later — it is an
architectural decision you make on day one or never.

## What I built

A Chrome extension holds the engine. It makes every LinkedIn call, in your own logged-in session,
using the same internal endpoints the LinkedIn page itself calls. It owns the quotas, the delays,
the campaign scheduler and the approval queue.

A local Node process bridges to it over a WebSocket on `127.0.0.1`. That process exposes 39 MCP
tools over stdio, a `POST /actions/{action}` HTTP API with a generated OpenAPI document, a SQLite
mirror with a read-only SQL tool, outbound webhooks, and a CLI. There is no hosted component
anywhere. Nothing to sign up for, nothing to log into, nothing to leak.

The design decision I am happiest with is that **the popup and the MCP server are two clients of
one engine.** There is a single `handle(action, params, origin)` switch in the service worker, and
a button in the popup, a CLI command, an MCP tool call and a campaign step firing on an alarm all
go through it. The caps, the jitter, the business-hours window and the approval queue sit below
that switch.

Which means an agent cannot do anything a human could not do in the popup, and cannot do it
faster. Not because I asked it nicely in a system prompt. Because there is no other path.

One more thing I had to design for, because it is what actually killed the last generation of
these extensions. LinkedIn now serves nearly all of its data through
`GET /voyager/api/graphql?queryId=<name>.<32-hex hash>`, and that hash is a build artefact that
changes with each web client release — the current one is 1.13.46474. The old REST Voyager paths
that every 2024–2025 extension hard-coded return 400, 410 or 500 today, which is why so many of
them silently return nothing and their users assume they have been flagged. It is also why the
cloud vendors run the automation on their own servers: a query-ID change is a deploy for them, and
every customer is fixed within the hour — but only because your session cookie lives on their
infrastructure rather than your laptop. I did not want that trade, so the toolkit calls the same
GraphQL queries your LinkedIn tab calls and keeps every query ID in one table with its capture
date and client version, with a `lit endpoints check` command that tells you which ones still
work. I will not pretend that is free: the IDs will drift, and re-capturing them is the
maintenance this project needs help with. But it is a table edit — filter DevTools for
`voyager/api`, copy the `queryId` off a request the page makes, open a PR — not a rewrite.

## The numbers that cannot move

100 invites, 150 messages, 500 profile visits and 1,000 search results per day. `config.set`
clamps whatever you pass. The MCP server cannot raise them. The CLI cannot raise them. Your agent
cannot raise them, and if it tries, it gets `QUOTA_EXCEEDED` with the cap number attached.

Every agent-originated write queues for human approval. You see what would be sent, you edit it,
you approve or reject it. Autopilot exists, and turning it on is a toggle in the popup that only a
person can flip — no config file, no API call. Even then, approving is not sending: an approved
item still waits for the jittered delay and the business-hours window.

And on a 451 — LinkedIn's security challenge — every write pauses and stays paused until a human
clears it in Chrome. There is no retry loop in the codebase. Retrying after a challenge is
precisely the behaviour that turns a warning into a restriction, and I would rather the tool
frustrate you than quietly cost you your account.

## Why give it away

Three honest reasons.

**The moat was never the software.** Sequences, CSV export, connection requests on a timer — none
of it is hard. What is hard is distribution and trust, and I was not going to out-distribute a
funded company. Open source is a different game entirely.

**Local-first only works if it's inspectable.** The whole pitch is "your data never leaves your
machine". You should not take my word for that. You should be able to read the code, and grep it
for `fetch`, and find nothing pointing anywhere I control. A closed-source tool making that claim
is asking for faith. An open one is offering evidence.

**Agent tooling wins by being everywhere.** The value of a LinkedIn layer for AI agents is
proportional to how many agents can reach it. A paid closed API gets adopted by the people who pay
for it. An MIT-licensed MCP server with wrappers for nine frameworks gets adopted by anyone who
finds it, and turns up in other people's examples, which is worth more than a subscription line.

There is also a fourth reason I will admit to: I wanted to build the thing properly. Clean
architecture, real safety controls, documentation that respects the reader. That is more fun with
the code open than closed, and it is a better demonstration of how I work than any CV.

## The caveat I will not bury

LinkedIn's User Agreement prohibits automated access. This tool automates LinkedIn. That clause
does not have a "but I paced it nicely" exception.

What the architecture does is reduce the *technical* risk of detection substantially — no
fingerprint delta, no IP delta, human pacing, hard caps, no retry after a challenge. It does
nothing at all to the contractual position. Use your own account. Keep the volumes conservative.
Keep a human in the loop. Do not automate anything you would be embarrassed to have sent by hand.

The full detection write-up — fingerprints, proxy provenance, timing signatures, challenge flows —
is [here](https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/master/docs/why-browser-agents-fail-on-linkedin.md),
and is the piece I would read first if I were you.

---

**Repo:** https://github.com/OpenRecruiterTools/linkedin-toolkit — MIT. Contributions welcome; adding a new
extractor touches four files and there is a guide for it.
