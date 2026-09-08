---
name: linkedin-sourcer
description: Turn a role brief or ICP description into a scored, deduplicated LinkedIn shortlist saved as a named list and a CSV. Use when the user says "source candidates", "find me people who", "build a shortlist", "who should I reach out to", "find CTOs at", "search LinkedIn for", or hands over a job description or ideal-customer profile and asks for names.
---

# LinkedIn Sourcer

Turns a brief into a shortlist. Searches LinkedIn through the user's own Chrome session via the
LinkedIn Toolkit MCP server, deduplicates against lists the user already has, scores each profile
against the brief, and writes the winners into a named list plus a CSV the user can hand to anyone.

## When to use

- The user gives a role brief, job description, or ICP and wants candidates or prospects.
- The user wants a list built from a company's employees, a post's engagers, an event's attendees,
  or a group's members.
- The user asks "who else looks like this person?" — run the search from that profile's title,
  company, and location.

Do **not** use this skill to send anything. Sourcing ends at a list. Outreach is
`linkedin-outreach-writer` and `linkedin-campaign-runner`.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `brief` | yes | Free text: role, seniority, skills, industry, location, must-haves, nice-to-haves. |
| `count` | no | Target shortlist size. Default 25. Ask before exceeding 100. |
| `list_name` | no | Defaults to a short slug of the brief plus today's date. |
| `sources` | no | Any of: keyword search, company employees, post engagers, event attendees, group members. Default keyword search. |
| `source_tier` | no | `search` (free), `salesnav`, or `recruiter`. Default `search`. Only use the paid tiers if `linkedin_get_status` shows the account preset supports them. |

## Steps

1. **Check the engine is alive and has headroom.**
   Call `linkedin_get_status` with `{}`. Stop and report if `connected` is false or `loggedIn` is
   false. Read `quotas.search.dailyUsed` and `quotas.search.dailyCap` — if the remaining search
   quota is smaller than the target count, say so up front and plan a smaller batch.

2. **Turn the brief into 2–4 search queries.** Do not run one giant query. Vary the title
   synonyms (for example "VP Engineering", "Head of Engineering", "Director of Engineering") and
   keep location and industry constant. Write the queries out for the user before running them.

3. **Run each query.**
   `linkedin_search_people` with
   `{ keywords: "...", title: "...", company: "...", location: "...", source: "search", start: 0, count: 50 }`.
   `count` is capped at 100 per call. Page by passing the returned `nextStart` back as `start`.
   Stop paging as soon as you have 3× the target count of raw results or the search quota is spent.

4. **Deduplicate.**
   Call `linkedin_list_all` with `{}` to see existing lists, then `linkedin_list_members` with
   `{ listId: "...", start: 0, count: 200 }` for any list that plausibly overlaps. Drop every
   `publicId` already present, and drop duplicates within your own results. Report how many you
   dropped and why.

5. **Score against the brief.** For each surviving profile, score 0–100 from the fields you
   actually have (`headline`, `title`, `company`, `location`, `industry`, `skills`, `experience`).
   Write a one-line reason per profile. If a profile is thin and the decision is close, call
   `linkedin_get_profile` with `{ publicId: "...", full: true }` for the top borderline candidates
   only — each full capture spends visit quota.

6. **Create the list and add the winners.**
   `linkedin_list_create` with `{ name: "<list_name>", tags: ["sourced", "<brief slug>"] }`, then
   `linkedin_list_add` with `{ listId: "<listId>", publicIds: ["...", "..."] }`.

7. **Return the shortlist.** Sorted by score, highest first.

## Output format

A short summary line, then a table, then the next step.

```
Sourced 27 profiles for "Head of Engineering, fintech, London" · list "heng-fintech-london-2026-09-08" (listId lst_a1b2)
Searched 3 queries · 84 raw results · 41 duplicates dropped · 16 below threshold

| # | Name | Title | Company | Location | Score | Why |
|---|------|-------|---------|----------|-------|-----|
| 1 | ... | ... | ... | ... | 92 | 8 yrs scaling payments teams, current co. is Series B fintech |
```

Then: `Next: run linkedin-outreach-writer over list lst_a1b2, or linkedin-campaign-runner to
sequence them.`

Also offer the CSV: the user can run `lit export --table profiles --csv` or use the popup's
Lists tab to download it.

## Guardrails

- **Facts only.** Every field in the output must come from a tool result. Never guess an email,
  a tenure, a salary, or a reason to reach out. If a field is missing, write `—`.
- **Quotas are the engine's, not yours.** Never try to raise a cap, never loop past a
  `QUOTA_EXCEEDED` or `RATE_LIMITED` error. On `RATE_LIMITED`, report `nextAllowedAt` and stop.
  On `CHALLENGE_DETECTED`, stop everything immediately and tell the user to clear the challenge
  in their browser — do not retry.
- **No writes.** This skill never calls `linkedin_send_invite`, `linkedin_send_message`,
  `linkedin_follow`, `linkedin_view_profile` in bulk, or any other write tool.
- **Copilot mode still applies** to anything downstream. Say so when handing off.
- **Ask before going wide.** Anything over 100 profiles or over 3 pages of search gets confirmed
  with the user first, with the quota cost stated.
- **Never fabricate a publicId.** Only use ids returned by a tool.
