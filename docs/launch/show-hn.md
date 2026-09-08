# Show HN

**Title** (78 chars, under HN's 80 limit):

```
Show HN: LinkedIn blocks AI browser agents, so I built an open-source MCP layer that works from your own Chrome
```

That is 110 characters — HN truncates at 80. Use this instead:

```
Show HN: An open-source MCP layer that lets agents use LinkedIn from your Chrome
```

**URL:** `https://github.com/OpenRecruiterTools/linkedin-toolkit`

**Text** (first comment, posted immediately after submitting):

> I kept watching browser agents get challenged and then banned on LinkedIn. Headless fingerprints,
> datacenter IPs, machine-speed clicks — it is the one site that is genuinely well defended against
> exactly that, and people were burning real accounts on demos.
>
> So the calls come from inside instead. A Chrome extension calls the same internal endpoints the
> LinkedIn page itself calls, in your own logged-in session, with your cookies and your IP. A local
> Node process bridges to it over a localhost WebSocket and exposes 39 MCP tools, an HTTP API with
> OpenAPI, a SQLite mirror with a read-only SQL tool, and a CLI. There is no hosted anything.
>
> The parts I think are actually interesting: hard caps live in the extension, below every client,
> so no agent can raise them — 100 invites, 150 messages, 500 profile visits a day. Every
> agent-originated write queues for human approval by default. A 451 challenge pauses everything
> and there is no retry loop in the codebase, because retrying after a challenge is what turns a
> warning into a restriction.
>
> It is also a complete Waalaxy/PhantomBuster replacement if you never touch an agent — extraction,
> lists, sequences with branching, inbox, 20 templates.
>
> On the thing that actually broke the last generation of these extensions: LinkedIn now serves
> nearly everything through `GET /voyager/api/graphql?queryId=<name>.<32-hex hash>`, and the hash
> changes with each web client release (currently 1.13.46474), so the old REST Voyager paths
> everyone hard-coded return 400/410/500 and the extensions using them just go quiet. That is also
> why the commercial tools moved the automation onto their own servers — they can patch a query ID
> centrally, at the cost of holding your session cookie. I kept it in the browser instead, so every
> query ID lives in one table with its capture date and client version and `lit endpoints check`
> tells you which ones still work. The IDs will drift; re-capturing one is a DevTools network
> filter on `voyager/api`, copy the queryId off a request the page makes, and a PR against the
> table. That is the maintenance model, and it is the thing I would most like help with.
>
> Write-up on the detection side, which is the part I found most interesting to research:
> https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/main/docs/why-browser-agents-fail-on-linkedin.md
>
> MIT. Not on the Chrome Web Store — load unpacked from a release zip, deliberately.
>
> Obvious caveat: LinkedIn's User Agreement prohibits automation and this does not change that. It
> reduces the technical risk; it cannot change the contractual position. Use your own account.

Word count: ~360. Trim to the first three paragraphs plus the caveat if you want it tighter; the
endpoint-drift paragraph is the one HN is most likely to engage with, so keep it if you keep any.

---

## Posting notes

**When.** Tuesday–Thursday, 08:00–10:00 ET. Avoid Friday, avoid weekends, avoid a big-news day.

**Do not** ask anyone to upvote. It is detectable and it is fatal.

**Be there for the first three hours.** The comment thread is what determines whether it stays on
the front page. Answer everything, fast, including the hostile ones.

## Comments to expect, and honest answers

**"This violates LinkedIn's ToS."**
> It does — the README says so in bold and the disclaimer covers it. Their User Agreement
> prohibits automated access. I have no interest in pretending otherwise. What the tool does is
> reduce the technical risk of detection and put a human in the loop; it cannot change the
> contractual position, and I would not use it on an account I could not afford to lose.

**"LinkedIn will send you a cease and desist."**
> Possibly. It is MIT-licensed, forked, and requires the user's own session and their own login —
> there is no service to shut down. I am also not doing the things that get people sued: no
> unauthenticated scraping, no proxies, no CAPTCHA solving, no reselling data.

**"How is this different from every other LinkedIn automation tool?"**
> Three things. It is local — your session never touches a server I control, because there is no
> server. It is agent-native — 39 MCP tools, an OpenAPI surface, framework wrappers, skills, not a
> UI with an API bolted on. And the safety controls are below the API surface rather than above it,
> so an agent literally cannot raise a cap or skip the queue.

**"hiQ v LinkedIn made scraping legal."**
> hiQ was about *public* data and the CFAA, and even that ended with hiQ losing on breach of
> contract. This is authenticated access to your own account, which is squarely a contract
> question, not a CFAA one. Different situation, and not a defence I would lean on.

**"Why not just use Playwright with stealth plugins?"**
> Because it does not work, and the article linked above goes through why in detail. The short
> version: fingerprint patching is a losing arms race against a server-side model trained on
> hundreds of millions of real sessions, datacenter IPs are their own confession, and the timing
> signature is harder to fake than any of it. Also, when it fails it fails on a real person's
> account.

**"Isn't this just spam infrastructure?"**
> It can be, like every outreach tool. What I could do about it: caps that cannot be raised, a
> human approval queue on by default, sequence templates that all end by saying they will stop, and
> documentation that says plainly that a generic template at volume is how you get restricted. What
> I could not do is make it impossible to misuse without making it useless.

**"Why not the Chrome Web Store?"**
> CWS policy forbids extensions that facilitate third-party ToS violations. A listing would be
> taken down, publicly, and the extension would then be silently disabled in everyone's browser.
> Release zip and load-unpacked is less convenient and much more honest.

**"Show me it working."**
> [Transcript link.] Full run, tool call by tool call, ending in the approval queue.
