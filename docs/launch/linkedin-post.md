# LinkedIn posts

Three variants. Pick one; do not post all three. Post between 08:00 and 10:00 local on a Tuesday
or Wednesday, reply to every comment in the first two hours, and put the repo link in the **first
comment** rather than the post body — LinkedIn throttles posts with external links.

Note the mild irony of announcing a LinkedIn automation tool on LinkedIn. Lean into it in the
comments; do not make it the post.

---

## Variant A — the technical one

> LinkedIn is very good at blocking AI browser agents. I spent a while working out exactly how,
> and then built the thing that doesn't get blocked.
>
> The detection is not one trick, it's four:
>
> → **Fingerprints.** A headless or CDP-driven browser differs from a real one in dozens of small
> ways. Patching them is a losing arms race against a model trained on hundreds of millions of real
> sessions.
>
> → **IPs.** Cloud agents connect from AWS or GCP ranges. The commercial fix is residential proxy
> pools — which means routing your authenticated professional identity through a stranger's home
> router, and LinkedIn already has the lists.
>
> → **Timing.** A human's browsing is jagged. A script is a metronome. Adding random jitter gives
> you a uniform distribution, which is also not what humans produce. The rhythm is the fingerprint,
> and it is the hardest one to fake.
>
> → **Challenges.** When something scores badly, LinkedIn returns a checkpoint, not an error. A
> human solves it. An agent retries — and the retry is what turns a warning into a restriction.
>
> So the answer isn't a better disguise. It's not being in disguise.
>
> LinkedIn Toolkit runs as a Chrome extension in the session you're already logged into, calling
> the same internal endpoints the LinkedIn page itself calls. Real browser, real cookies, real IP,
> real device. Nothing to detect because nothing is synthetic.
>
> Then it gives any AI agent — Claude, Cursor, LangChain, CrewAI, n8n — a proper API to that
> session: 39 tools returning typed JSON instead of screenshots. Hard caps enforced inside the
> extension that no agent can raise. Every agent-written message queues for human approval before
> it sends.
>
> Open source, MIT, runs entirely on your machine. No cloud, no subscription, no telemetry.
>
> Link in the comments. Would genuinely like to hear from anyone who has fought the same detection
> problem.

---

## Variant B — the practical one

> I built a free, open-source replacement for Waalaxy and PhantomBuster. It runs on your own
> machine and it costs nothing.
>
> What it does:
>
> ✅ Export profiles, searches, Sales Navigator and Recruiter results, post likers and commenters,
> group members, event attendees, company employees
> ✅ Lists with tags, dedupe, and intent signals — changed job in 90 days, engaged with your post
> ✅ Multi-step sequences with branching on accepted and replied, A/B variants, 20 templates
> ✅ Unified inbox with reply detection and sentiment
> ✅ Research Pack: a CSV of names in, a dossier per person out
> ✅ CSV, JSON and SQLite export — your data, in a file, that you own
>
> What is different about it:
>
> Everything runs in your own Chrome, in the session you already logged into. Your account details
> never touch a server, because there is no server. Compare that to any cloud tool, where your
> LinkedIn session lives in someone else's datacenter alongside a few thousand others.
>
> And it is built for AI agents. If you use Claude, Cursor or ChatGPT for work, you can now say
> "find me 20 heads of data engineering at Series B fintechs in London and draft invites" and get
> exactly that — with every draft waiting in a queue for you to approve before anything sends.
>
> The safety controls are the part I spent longest on. Hard daily caps that no agent can raise.
> Human-paced delays. Business hours. A 14-day warm-up for new accounts. It stops dead on a
> security challenge instead of retrying into a ban.
>
> Waalaxy Pro is about €70 a month. PhantomBuster starts around $69. This is £0 and MIT licensed.
>
> Link in the comments.
>
> (Yes, I am aware of the irony of posting this here.)

---

## Variant C — the short one

> Browser agents get banned on LinkedIn. I built the thing that doesn't.
>
> Instead of driving a headless browser from outside, it runs in the Chrome session you're already
> logged into and gives your AI agent a proper API to it — typed JSON, not screenshots. 39 tools.
> Works with Claude, Cursor, LangChain, CrewAI, n8n and anything that speaks HTTP.
>
> Hard caps live in the extension and no agent can raise them. Every message an agent writes waits
> in a queue until you approve it. On a security challenge it stops, and there is no retry loop
> anywhere in the codebase.
>
> Also a complete free replacement for Waalaxy and PhantomBuster if you never touch an agent.
>
> Open source, MIT, runs entirely on your machine. Link in the comments.

---

## First comment (all variants)

> Repo: https://github.com/FormatixAI/linkedin-toolkit
>
> The write-up on how LinkedIn actually detects browser automation is here, and is worth reading on
> its own if you have fought this:
> https://github.com/FormatixAI/linkedin-toolkit/blob/main/docs/why-browser-agents-fail-on-linkedin.md
>
> Worth saying plainly: LinkedIn's User Agreement prohibits automated access. This reduces the
> technical risk of detection; it does not change that. Use your own account, keep the volumes
> conservative, keep a human in the loop.

## Replies to have ready

**"Isn't this against LinkedIn's terms?"**
> Yes, and the README says so in bold. Their User Agreement prohibits automated access. I would
> rather say that clearly than bury it. The tool never bypasses a security measure — when LinkedIn
> challenges, it stops and hands the problem to you.

**"Will this get my account banned?"**
> It can. Anything that automates LinkedIn can. What I have done is put hard caps in that nothing
> can raise, pace everything like a human, ramp new accounts over two weeks, and stop dead on a
> challenge. Start conservative — 10 to 15 invites a day — and never run two automation tools on
> one account.

**"I'm not technical, can I use it?"**
> Right now: if you can unzip a file and paste a token, yes. If you cannot use a terminal at all,
> not yet. A desktop app that removes that step is on the roadmap.

**"Can it write the messages for me?"**
> Your agent can, or a model key you paste into the extension — including a local one via Ollama,
> in which case nothing leaves your machine at all. Either way the drafts queue for your approval,
> and the skills forbid inventing anything that is not in the person's profile.
