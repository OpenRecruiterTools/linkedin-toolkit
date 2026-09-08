# Product Hunt

Launch at Phase 4, when extraction parity, lists, the sequence engine, inbox and SQLite sync are
all shipped. PH audiences are less forgiving of "coming soon" than HN is.

**Ship day:** Tuesday or Wednesday, live at 00:01 PT. Be awake for it.

---

## Name

`LinkedIn Toolkit`

## Tagline

60 characters is the ceiling. In order of preference:

```
Open-source LinkedIn automation for humans and AI agents      (58)
```

```
LinkedIn blocks AI agents. This one runs in your own Chrome   (59)
```

```
The free, local-first Waalaxy alternative built for agents    (57)
```

## Description

*(260 characters max)*

```
LinkedIn blocks AI browser agents. This runs inside the Chrome you're already logged into —
giving any agent a real API to LinkedIn, with hard caps and a human approval queue. Also a
complete free replacement for Waalaxy and PhantomBuster. MIT, local, no cloud.
```

## Topics

`Artificial Intelligence` · `Developer Tools` · `Open Source` · `Sales` · `Chrome Extensions`

## Links

- **Website:** `https://github.com/FormatixAI/linkedin-toolkit`
- **GitHub:** same
- **Also try:** `https://github.com/FormatixAI/linkedin-toolkit/blob/main/docs/why-browser-agents-fail-on-linkedin.md`

## Gallery

1. **The demo GIF** — 30 seconds: ask → search → drafts → approve. This is the whole pitch and it
   is the only asset most people will look at.
2. **Approval queue** — the popup with eight pending drafts and the approve / edit / reject
   buttons. This is the differentiator; make it a clean screenshot.
3. **Agent transcript** — the Claude Code run, tool calls visible, ending in the queue.
4. **Comparison table** — browser agents vs LinkedIn Toolkit. Legible at thumbnail size.
5. **Architecture diagram** — the one from the README, showing that nothing leaves the machine.
6. **Sequence builder** — the popup's Campaigns tab with a branching sequence.

---

## First comment (post immediately)

> Hi Product Hunt 👋
>
> I built this after watching an AI browser agent get a real LinkedIn account restricted in about
> twenty minutes. Headless fingerprints, datacenter IPs, machine-speed clicks — LinkedIn is one of
> the best-defended sites on the consumer web and browser automation is precisely what it is
> defended against.
>
> So this works the other way round. A Chrome extension runs inside the session you are already
> logged into, calling the same internal endpoints the LinkedIn page itself calls. Your real
> browser, your real cookies, your real IP. There is no fingerprint to detect because nothing is
> synthetic.
>
> On top of that sits a local server exposing 39 MCP tools, an HTTP API, a SQLite mirror and a CLI.
> So you can say to Claude or Cursor: *"find 20 heads of data engineering at Series B fintechs in
> London, skip anyone I know, draft invites for the top 8"* — and it does, and every draft waits in
> an approval queue until you read it.
>
> **The three things I would want to know if I were you:**
>
> 🔒 **Nothing leaves your machine.** No hosted service, no cloud session, no telemetry. Your data
> is a SQLite file you own. Everything is MIT so you can check that claim rather than trust it.
>
> 🛑 **The safety controls are below the API.** Hard caps of 100 invites / 150 messages / 500
> profile visits a day live inside the extension. No agent, CLI flag or config file can raise them.
> Every agent-written message queues for human approval by default. On a LinkedIn security
> challenge it stops completely — there is no retry loop in the codebase, because retrying after a
> challenge is what turns a warning into a restriction.
>
> 💸 **It is free.** Waalaxy Pro is about €70/month, PhantomBuster around $69, Sales-Mind about $99.
> This is £0 and always will be — there is no paid tier planned, because there is no server to pay
> for.
>
> Being straight with you: LinkedIn's User Agreement prohibits automated access. This reduces the
> technical risk substantially; it does not change that. It never bypasses a security measure, uses
> no proxies, and only ever touches the account you logged into yourself.
>
> Happy to answer anything — architecture, the detection research, or why I gave it away instead of
> charging for it.

## Prepared answers

**"How is this different from Waalaxy?"**
> Three ways. It runs on your machine rather than their cloud, so your session never sits on
> someone else's server. It is built for AI agents from the ground up — 39 MCP tools, an OpenAPI
> surface, wrappers for nine frameworks — rather than a UI with an API bolted on. And it is free
> and MIT, so you can read exactly what it does with your data.

**"Is this legal?"**
> Automating LinkedIn breaches their User Agreement — that is in the README in bold. It is a
> contract question, not a criminal one, and the consequence is account action rather than legal
> action. What the tool never does is bypass a security measure: no CAPTCHA solving, no proxies, no
> cookie theft, no accounts you are not signed into.

**"Will I get banned?"**
> Possible with any automation. The mitigations are hard caps nothing can raise, human-paced
> jittered delays, business hours, a 14-day warm-up for new accounts, and stopping dead on a
> security challenge. Start at 10–15 invites a day, never run two tools on one account, and do not
> use it on an account you cannot afford to lose.

**"Do I need to be technical?"**
> Today: unzip a folder, run one command, paste a token. If you have never opened a terminal, not
> yet — a desktop app is on the roadmap.

**"What's the business model?"**
> There isn't one. No server means no costs to cover. I built it because the tool I wanted did not
> exist, and open sourcing it is how a tool like this gets adopted.
