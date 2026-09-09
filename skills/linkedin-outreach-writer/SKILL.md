---
name: linkedin-outreach-writer
description: Write personalised LinkedIn connection notes, DMs and InMails from facts in the profile only, in a chosen tone, within LinkedIn's character limits. Use when the user says "write an opener", "draft a connection note", "personalise this outreach", "write a DM to", "message these people", or hands over a profile or list and asks what to say.
---

# LinkedIn Outreach Writer

Writes openers that sound like a person wrote them, using only facts the toolkit actually
returned. Queues them for human approval. Never sends silently.

## When to use

- The user wants a connection note, first message, follow-up, or InMail for one person.
- The user wants openers generated across a list before a campaign.
- The user wants an existing draft rewritten in a different tone or shortened to fit a limit.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `target` | yes | A `publicId`, a profile URL, or a `listId`. |
| `goal` | yes | What the message is for: intro call, role pitch, partnership, advice, event invite. |
| `tone` | no | `warm` (default), `direct`, `peer`, `formal`, `playful`. |
| `channel` | no | `invite` (note, ≤ 200 chars), `message` (DM), `inmail` (subject + body). Default `invite`. |
| `sender_context` | no | Who the user is and why they are credible. Ask for it if missing — it is the difference between a good opener and a template. |

## Steps

1. **Gather the facts.**
   - One person: `linkedin_get_profile` with `{ publicId: "...", full: true }`.
   - A list: `linkedin_list_members` with `{ listId: "...", start: 0, count: 50 }`, then
     `linkedin_get_profile` per member only where the list member's stored profile is thin.
   - Optional context: `linkedin_get_company` with `{ universalName: "..." }` for a company hook.

2. **Check connection state before choosing a channel.**
   `linkedin_get_connection_status` with `{ publicIds: ["..."] }`.
   - `none` → `invite` (note ≤ 200 characters) or `inmail` if the account has credits.
   - `pending` → do not write anything; the invite is already out.
   - `connected` → `message`.

3. **Pick one hook per person.** Exactly one, from this priority order, and only if present in
   the profile data:
   1. A recent post or comment of theirs (from `recentPosts` on a Research Pack, or the profile
      page text).
   2. A job change inside the last 90 days (compare `experience[0].start` with today).
   3. Something specific in their current role — a product, a market, a team size they state.
   4. A shared company, school, or group that is visible in both profiles.
   5. A company-level fact from `linkedin_get_company` (funding, hiring, market).
   If none of these exist, say so and write a short, honest, non-personalised note. Do not invent
   a hook.

4. **Draft.** Structure for a connection note (**200 characters is LinkedIn's hard limit; aim for
   180 or fewer** so a long name or job title cannot push it over):
   - Line 1: the hook, in their words not yours.
   - Line 2: why you specifically, one clause.
   - Line 3: a low-friction ask ("worth a chat?" not "book 30 minutes here").
   For a DM, up to 600 characters and the same shape with one extra sentence of substance.
   For an InMail, a subject under 60 characters plus a body under 800.
   Write a **second variant** with a different opening angle so the user can A/B it.

5. **Self-check every draft** against the Guardrails checklist below. Rewrite anything that fails.

6. **Queue, do not send.** Only when the user says to send:
   - `linkedin_send_invite` with `{ publicId: "...", note: "..." }`
   - `linkedin_send_message` with `{ publicId: "...", body: "..." }`
   - `linkedin_send_inmail` with `{ publicId: "...", subject: "...", body: "..." }`
   Use `dry_run: true` first for the first three of any batch and show the result. In Copilot mode
   the engine returns `{ status: "queued", queueId }` — tell the user the drafts are waiting in the
   extension popup's Queue tab, and offer `linkedin_queue_list` with `{ status: "pending" }`.

## Output format

Per person:

```
Ana Ferreira · Head of Data, Monzo · connection status: none · channel: invite

Variant A (287 chars)
"..."
Hook: her 2 Sep post on cutting feature-store latency
Facts used: headline, current company, post text

Variant B (241 chars)
"..."
Hook: moved from Revolut 6 weeks ago
```

For a list, the same block per person, then a summary: `12 drafts, 12 queued, 0 sent.`

## Guardrails

- **Only facts from tool results.** No invented mutual connections, no "I saw you spoke at…"
  unless a tool returned that talk, no guessed pronouns, no guessed seniority. If you would have
  to assume it, cut it.
- **No flattery filler.** Ban list: "I was impressed by your profile", "your impressive
  background", "I hope this message finds you well", "I came across your profile", "quick
  question", "As an AI".
- **Length is a hard limit, not a target.** **200 characters for an invite note** — count them, and
  aim for 180. The engine refuses a longer note with `INVALID_PARAMS` before it spends any quota,
  so an over-long draft is a wasted turn, not a sent message.
- **A note is a scarce resource on a free account.** LinkedIn allows only a handful of personalised
  (with-note) invitations a month; when they run out the invite is refused with `LINKEDIN_ERROR`.
  Spend notes where the hook is genuinely specific, and offer a note-less invite otherwise.
- **One ask per message.** No calendar links in a first touch unless the user insists.
- **Copilot mode is the default.** Assume every write queues for human approval. Never tell the
  user something was sent unless the tool returned `status: "sent"`.
- **Never bulk-send.** More than 5 messages at once gets an explicit confirmation, and the engine
  will pace them regardless.
- **Respect the errors.** `QUOTA_EXCEEDED` and `RATE_LIMITED` mean stop and report, not retry.
  `CHALLENGE_DETECTED` means stop everything.
- **Never write on someone's behalf in a way they would not recognise.** The user's voice, the
  user's claims, the user's credibility.
