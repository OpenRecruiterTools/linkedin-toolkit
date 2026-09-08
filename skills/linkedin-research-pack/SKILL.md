---
name: linkedin-research-pack
description: Turn a CSV of names, companies, domains or LinkedIn URLs into a dossier per row — resolved profile, company context, signals, public-web research and a suggested opener — plus an enriched CSV and a saved list. Use when the user says "research this list", "enrich this CSV", "build dossiers for", "prep these accounts", "who are these people", or drops a spreadsheet of leads or candidates and asks for background.
---

# LinkedIn Research Pack

The batch version of a dossier. Rows in, packs out. The toolkit resolves and captures from
LinkedIn; **you** add the public web with your own search tool; the result is a folder of
markdown briefs, an enriched CSV, and a list in the extension.

## When to use

- A CSV of leads, candidates, attendees, or accounts needs background before anyone is contacted.
- A conference list, a webinar registration export, or a target-account list needs to become
  something a human can act on.
- The user wants an enriched CSV: their columns plus resolved LinkedIn URL, title, company,
  location, signals, and match confidence.

For a single person, use `linkedin-profile-to-dossier` — it is faster and costs less quota.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `rows` | yes | Objects with any of `name`, `linkedinUrl`, `email`, `domain`, `company`. Extra columns are carried through untouched. |
| `list_name` | no | Name for the list the packs land in. Default `Research Pack <date>`. |
| `enrich` | no | Default false. Turns on the user's own enrichment provider for verified email/phone. Never enable without asking. |
| `full` | no | Default false. `true` adds full page capture and photo per row — much slower, much more visit quota. |
| `out_dir` | no | Where to write `pack.md` files. Default `./packs`. |

## Steps

1. **Status and budget.** `linkedin_get_status` with `{}`. Resolution spends search quota, capture
   spends visit quota. Tell the user, before starting, roughly how many rows will complete today
   and that the engine spreads the rest over following days. A 500-row CSV is a multi-day job by
   design; that is not a bug.

2. **Dry-run the resolution.** `linkedin_research_resolve` with `{ rows: [...] }` returns
   `ResolvedRow[]` with `kind` (`person` | `company` | `unresolved`), `publicId` or
   `universalName`, `confidence`, and `candidates` where ambiguous.
   - Show the user everything below ~0.7 confidence and every row with multiple candidates.
   - Let them pick or drop before you spend capture quota. Do not guess between two people with
     the same name.

3. **Run the pack job.**
   `linkedin_research_pack` with
   `{ rows: [...], listName: "<list_name>", enrich: false, full: false }`.
   It returns `{ jobId, total, etaMs }` and then emits `research_progress` and
   `research_completed` events. Poll with `linkedin_research_get` with `{ jobId: "..." }` —
   which returns `{ jobId, status, done, total, packs }`. Poll at a sane interval (30–60 s), not
   in a tight loop. Report progress as `done/total` with the ETA.

4. **Read what came back.** Each `Pack` carries `row`, `resolved`, `profile`, `company`,
   `recentPosts`, `mutualConnections`, `connectionStatus`, `signals`, optional `enrichment`,
   `markdown`, and `csvRow`. The `signals` array is the engine's read: job change in the last
   90 days, recent post activity, hiring signals, headcount band, mutual connections,
   engaged-with-me.

5. **Add the public web — this is your job, not the toolkit's.**
   The extension never crawls the open web. For each pack, run **your own** web search tool.
   Budget two to four searches per row and go in this order, stopping when you have three solid
   facts:
   1. **News** — the company in the last 12 months: funding, acquisition, launch, layoffs,
      leadership change, regulatory event.
   2. **Talks and podcasts** — the person speaking anywhere, with the title and date.
   3. **GitHub / writing** — repositories, blog posts, papers, newsletters they authored.
   4. **Anything else public and professionally relevant.**

   Append to each `pack.md`:

   ```markdown
   ## Public web
   - <Fact, one line> — [<source name>](<url>) · <date>
   - ...
   *No substantive public web results found.*   <!-- if that is the truth -->

   ## Suggested opener
   "<≤300 characters. One hook drawn from the strongest fact above or from signals. One ask.>"
   Hook used: <which fact, and where it came from>
   ```

6. **Deliver.** Write the packs to `out_dir`, confirm the list was created (it appears in
   `linkedin_list_all`), and give the user the enriched CSV path. Summarise the run.

## Output format

Run summary:

```
Research Pack · 84 rows · list "Research Pack 2026-09-08" (lst_c4d9) · packs in ./packs

Resolved   71 person · 6 company · 7 unresolved
Confidence 58 high (≥0.85) · 13 medium · 7 flagged for you
Signals    12 changed job <90d · 9 posted this week · 15 companies hiring · 22 with mutuals
Web        68 rows with ≥1 sourced fact · 16 with none
Enrichment off

Top 5 by signal strength
| Name | Title | Company | Signals | Best hook |
|------|-------|---------|---------|-----------|
```

Then the flagged rows, then the file list.

## Guardrails

- **Never invent a fact.** Every line in a pack traces to a tool result or a URL. If the web
  found nothing, write that it found nothing. An honest empty section beats a plausible sentence.
- **Never merge two people.** Same name, different person is the most common failure mode. If
  the web results might be someone else, label them `unverified — possible same-name match` or
  leave them out.
- **Confidence is reported, not hidden.** Every resolved row shows its `confidence`. Anything
  under 0.7 is flagged, not silently used.
- **Nothing is contacted here.** Research Pack is read-only. No invites, no messages, no follows.
  Hand off to `linkedin-outreach-writer` and `linkedin-campaign-runner`.
- **Copilot mode still governs everything downstream.** Say so.
- **Enrichment is off unless the user turns it on**, with their own provider key, having been
  told what it costs and what it sends where.
- **Caps are the point.** Resolution uses search quota, capture uses visit quota, and the hard
  ceilings (100 invites, 150 messages, 500 visits, 1,000 search results per day) cannot be raised
  by any client. On `QUOTA_EXCEEDED`, report how many rows remain and when the job resumes. On
  `RATE_LIMITED`, report `nextAllowedAt`. On `CHALLENGE_DETECTED`, stop the job and tell the user
  to clear the challenge in Chrome.
- **Professional relevance only.** No inferences about protected characteristics or private life.
- **Packs are local files** containing personal data. Remind the user they are subject to the
  same data-protection obligations as any other candidate or prospect record they hold.
