---
name: linkedin-reply-triage
description: Read the LinkedIn inbox, classify every new reply by intent and sentiment, draft a response for each, and surface the ones worth booking a call with. Use when the user says "triage my inbox", "what replies came in", "any good responses", "clear my LinkedIn messages", "who wants a meeting", or asks what to do about their unread LinkedIn DMs.
---

# LinkedIn Reply Triage

Turns an unread inbox into a decision list: who to book, who to answer, who to drop.

## When to use

- Daily or weekly inbox sweep after outreach has been running.
- After a campaign step lands and replies start arriving.
- The user asks whether anything important came in.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `since` | no | Epoch milliseconds or a phrase like "last 24 hours". Default: last 7 days. |
| `unread_only` | no | Default true. |
| `draft_replies` | no | Default true. Drafts are text until the user approves. |

## Steps

1. **Pull the threads.**
   `linkedin_get_conversations` with `{ since: <epochMs>, unreadOnly: true, count: 50 }`.
   Each `Thread` carries `threadId`, `participants`, `lastMessageAt`, `unread`, `snippet`, and
   sometimes `sentiment`.

2. **Read the ones that matter.** For every unread thread — and any thread whose snippet is
   ambiguous — `linkedin_get_messages` with `{ threadId: "...", since: <epochMs> }`. Read the
   user's own last message too; a reply only makes sense against what was asked.

3. **Classify each thread** into exactly one bucket:

   | Bucket | Signal | Action |
   |---|---|---|
   | `meeting` | Asks for a call, offers times, says "send an invite" | Draft a reply with two concrete time windows. Top of the report. |
   | `interested` | Asks a question, wants detail, "tell me more" | Draft a substantive answer, one paragraph, one next step. |
   | `not-now` | "Not right now", "circle back in Q1", "after we ship" | Draft a short, gracious note. Set a follow-up date. |
   | `referral` | Points at a colleague | Draft a thank-you and ask for the intro or the name. |
   | `no` | Clear decline | Draft one line, no rebuttal. Never argue. |
   | `opt-out` | "Stop", "remove me", "don't contact me" | **No reply drafted.** Flag for removal. |
   | `automated` | Out-of-office, holiday autoresponder | Ignore, note the return date. |
   | `unrelated` | Recruiter spam, sales pitch at the user | Summarise in one line only. |

   Add a sentiment tag (`positive` / `neutral` / `negative`) and a confidence. When you are under
   about 70% confident, say so and put the thread in a **Needs your eyes** section rather than
   guessing.

4. **Enrich the ones you will act on.** For `meeting` and `interested` threads only, pull context:
   `linkedin_get_profile` with `{ publicId: "...", full: false }` so the draft can reference their
   actual role. Do not full-capture the whole inbox.

5. **Draft replies.** Under 500 characters, matching the register of their message. Answer the
   question they actually asked before anything else. One next step. No links unless the user has
   given you one.

6. **Deliver, do not send.** Show the drafts. Only on the user's explicit go-ahead call
   `linkedin_send_message` with `{ publicId: "...", body: "..." }`. In Copilot mode this returns
   `{ status: "queued", queueId }`; point the user at the popup's Queue tab, or
   `linkedin_queue_list` with `{ status: "pending" }`.

7. **Stop the sequences.** For every `opt-out` and `no`, tell the user which campaigns those
   people are in (`linkedin_campaign_list`, `linkedin_campaign_get`) and offer to pause. The
   engine already stops a sequence on any reply when `stopOnReply` is true — confirm that it did.

## Output format

```
Inbox triage · 18 unread since 1 Sep · 6 need action

BOOK (2)
  Priya Raman · Director of Talent, Zopa · positive · high confidence
    They said: "Interesting — I have 20 mins Thursday or Friday morning."
    Draft: "..."

REPLY (4)
  ...

NOT NOW (3)   · follow-up dates suggested
NO (2)
OPT-OUT (1)   ⚠ Sam Whitfield — remove from cmp_7f21 and do not contact again
AUTOMATED (4) · back 15 Sep, 22 Sep
UNRELATED (2)

NEEDS YOUR EYES (1)
  Thread thr_9k2 — ambiguous, could be a soft no or a scheduling ask.

0 messages sent. 6 drafts ready — say "send" to queue them for approval.
```

## Guardrails

- **Never auto-send.** Triage is a reading task. Sending needs the user to say so, and in Copilot
  mode it still queues.
- **Opt-outs are absolute.** No reply, no rebuttal, no re-enrollment, ever. Flag them loudly.
- **Never argue with a no.** One line, gracious, done.
- **Do not paraphrase a message into something it did not say.** Quote the operative sentence
  verbatim in the report.
- **Uncertainty is reported, not smoothed over.** Low-confidence classifications go to
  **Needs your eyes**.
- **Private content stays local.** Message bodies are the user's private correspondence. Do not
  send them to any external service beyond the model already in this session, and never write
  them to a public file.
- **Respect the engine.** `RATE_LIMITED` → report `nextAllowedAt` and stop.
  `CHALLENGE_DETECTED` → stop entirely and tell the user.
- **No sentiment theatre.** If a thread has no clear signal, it is `neutral`.
