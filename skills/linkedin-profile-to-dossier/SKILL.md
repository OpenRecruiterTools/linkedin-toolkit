---
name: linkedin-profile-to-dossier
description: Turn one LinkedIn profile into a one-page briefing document with career arc, company context, talking points and open questions, sourced from the profile plus the agent's own web search. Use when the user says "brief me on", "prep me for this meeting", "who is this person", "background on", "one-pager on this candidate", or pastes a LinkedIn profile URL and asks what they should know.
---

# LinkedIn Profile to Dossier

One profile in, one page out. The kind of brief you would want ten minutes before a call.

## When to use

- Meeting prep: the user has a call with someone and wants to walk in informed.
- Candidate prep: an interviewer or hiring manager needs a summary before a screen.
- Sales prep: an AE needs context on a buyer before a discovery call.

For many people at once, use `linkedin-research-pack` instead — it batches and writes files.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `target` | yes | A LinkedIn profile URL or `publicId`. |
| `purpose` | no | Meeting, interview, sales call, partnership. Shapes the talking points. |
| `depth` | no | `quick` (profile only) or `full` (profile + company + web). Default `full`. |

## Steps

1. **Capture the profile.**
   `linkedin_get_profile` with `{ url: "https://www.linkedin.com/in/...", full: true }` — or
   `{ publicId: "...", full: true }`. `full: true` adds page text and photo and spends one visit
   from the daily cap.

2. **Capture the company.**
   `linkedin_get_company` with `{ universalName: "..." }` taken from the profile's `companyUrn`
   or company name. For headcount and hiring context you may also call
   `linkedin_get_company_employees` with `{ universalName: "...", start: 0, count: 10 }` — only
   if the user asked about the team.

3. **Check the relationship.**
   `linkedin_get_connection_status` with `{ publicIds: ["..."] }`. If `connected`, check for
   history: `linkedin_get_conversations` with `{ since: <ms epoch>, count: 20 }` and
   `linkedin_get_messages` with `{ threadId: "..." }` for any thread with this person. Past
   conversation is the single most useful thing in the dossier.

4. **Web layer — your own search tool.** The toolkit never crawls the open web. Use *your own*
   web search for, in this order: recent news mentioning the person or company; conference talks
   and podcast appearances; GitHub or published writing; funding, layoffs, product launches, or
   leadership changes at the company in the last 12 months. Two to five searches is enough.
   Every web fact carries its source URL.

5. **Write the dossier.** Format below. Separate what the toolkit returned from what the web
   returned — the reader needs to know which is verified profile data.

6. **Offer the next step.** An opener via `linkedin-outreach-writer`, or add to a list via
   `linkedin_list_add`.

## Output format

```markdown
# <Full name> — <Title> at <Company>
<LinkedIn URL> · <Location> · <1st/2nd/3rd degree> · captured <date>

## In one line
<Who they are and why this meeting matters, one sentence.>

## Career arc
- **<Company>** · <Title> · <start>–present (<duration>)
- **<Company>** · <Title> · <start>–<end>
<Then one sentence on the pattern: what they keep choosing, what they have never done.>

## Company context
<Name> · <industry> · <size band> · <HQ>
<Two or three sentences: what it does, where it is in its life, anything visible about hiring
or direction.>

## Public web
- <Fact> — [source](url)
- <Fact> — [source](url)
<If nothing credible was found, write: "No substantive public web results found." Do not pad.>

## Our history
<Connection status, any past messages with dates, or "No prior contact.">

## Talking points
1. <Specific, grounded in something above.>
2. ...
3. ...

## Open questions
- <What the profile does not tell you and you would want to ask.>

## Suggested opener
"<≤200 characters — LinkedIn's limit for an invitation note; aim for 180. One hook, one ask.>"

## Gaps
<Fields that were empty or ambiguous. Be explicit — this is what stops the reader trusting the
rest wrongly.>
```

## Guardrails

- **Never invent.** No inferred tenure, no guessed reason for a job change, no assumed seniority,
  no speculation about why someone left a company. Missing means `—` or a line in **Gaps**.
- **Separate sourced from searched.** Toolkit facts and web facts live in different sections, and
  every web fact has a URL.
- **Same-name risk is real.** If the web results might be a different person with the same name,
  say so explicitly rather than merging them.
- **This is a briefing, not a file.** No inferences about protected characteristics, health,
  politics, religion, family, or anything not professionally relevant. If the user asks for that,
  decline and explain.
- **One visit costs quota.** Do not re-capture a profile you already have in the same session.
  On `RATE_LIMITED` report `nextAllowedAt`; on `CHALLENGE_DETECTED` stop.
- **No writes.** This skill never sends an invite, message, or comment. It drafts an opener as
  text only.
