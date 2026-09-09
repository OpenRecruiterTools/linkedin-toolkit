---
name: linkedin-campaign-runner
description: Build a multi-step LinkedIn sequence from a template, enroll a list, monitor it, and report accept and reply rates per step. Use when the user says "run a campaign", "set up a sequence", "enroll this list", "start outreach to", "how is my campaign doing", "pause the campaign", or names one of the templates in sequences/.
---

# LinkedIn Campaign Runner

Takes a list and a sequence template, creates the campaign in the extension engine, enrolls
people, and reports on it. The engine does the pacing, branching, and stopping — this skill sets
it up correctly and reads it back honestly.

## When to use

- The user has a list (from `linkedin-sourcer` or the popup) and wants it worked through a sequence.
- The user wants a sequence built from scratch or adapted from `sequences/*.json`.
- The user asks how a running campaign is performing, or wants it paused or resumed.

## Inputs

| Input | Required | Notes |
|---|---|---|
| `list_id` or `public_ids` | yes | Who to enroll. |
| `template` | no | A file from `sequences/` (for example `sequences/warm-connect.json`). If absent, build the steps with the user. |
| `name` | no | Campaign name. Default: template name + list name + date. |
| `settings` | no | `{ stopOnReply: true, autopilot: false }`. Keep both defaults unless the user explicitly changes them. |

## Steps

1. **Status first.** `linkedin_get_status` with `{}`. Report `autopilot`, `businessHours`,
   `quotas.invite` and `quotas.message` headroom, and any `backoffUntil` or `challenge`. If a
   challenge is present, stop — do not create a campaign that will immediately stall.

2. **Load or build the steps.** A step is:
   `{ type: "view"|"follow"|"invite"|"message"|"inmail"|"like"|"comment"|"wait"|"branch",
      note?, body?, subject?, variants?, waitMs?, branch? }`.
   Rules that make sequences work:
   - Start with `view` (and optionally `follow`) before `invite`. It warms the target and it is
     what a human does.
   - Put a `wait` of at least 24 hours (`waitMs: 86400000`) between every outreach step.
   - Use `variants` (2 per message step) so the engine A/B tests rather than sending one template
     to everyone.
   - Branch on acceptance rather than blindly messaging:
     `{ type: "branch", branch: { on: "accepted", ms: 604800000, then: [...], else: [...] } }`.
   - Personalisation uses `{{firstName|there}}`, `{{company|your team}}`, `{{title}}` — always
     with a fallback after the pipe.
   Show the user the full step list and the total elapsed time before creating anything.

3. **Create.** `linkedin_campaign_create` with
   `{ name: "...", steps: [...], listId: "...", settings: { stopOnReply: true, autopilot: false } }`.
   Keep the returned `campaignId`.

4. **Enroll.** `linkedin_campaign_enroll` with `{ campaignId: "...", publicIds: ["..."] }`.
   Report `enrolled` and `skipped` — skipped usually means already enrolled or already contacted.

5. **Monitor.** `linkedin_campaign_get` with `{ campaignId: "..." }` returns `stats`:
   `enrolled`, `sent`, `accepted`, `replied`, `positive`, and `byStep`. Compute accept rate
   (`accepted / sent` on the invite step) and reply rate (`replied / accepted`).
   Use `linkedin_queue_list` with `{ status: "pending" }` to show the human what is waiting for
   approval, and `linkedin_campaign_list` with `{}` for a portfolio view.

6. **Control.** `linkedin_campaign_pause` / `linkedin_campaign_resume` with `{ campaignId: "..." }`.
   Pause proactively and tell the user when: accept rate under 15% after 30 invites, any reply
   containing an opt-out, `quota_hit` firing repeatedly, or `CHALLENGE_DETECTED`.

## Output format

On creation:

```
Campaign "Warm connect · heng-fintech-london" (cmp_7f21) created — 6 steps over 12 days
  1. view
  2. wait 1d
  3. invite (2 variants, ≤200 chars)
  4. branch on accepted within 7d
       then: wait 2d → message (2 variants) → wait 4d → message
       else: wait 7d → follow
Enrolled 27 of 27 · 0 skipped · autopilot OFF (every write queues for approval)
```

On a status check:

```
Campaign cmp_7f21 · active · day 5 of 12
Enrolled 27 · Sent 24 · Accepted 9 (37.5%) · Replied 4 (44.4% of accepted) · Positive 3
By step — 1 view 27/27 · 3 invite 24 sent, 9 accepted · 5 message 9 sent, 4 replied
Queue: 3 pending approvals
```

## Guardrails

- **Autopilot stays off unless the user turns it on themselves, in the popup.** This skill never
  sets `autopilot: true`. Say plainly that writes queue for approval.
- **`stopOnReply` stays true.** Never sequence over someone who has already replied.
- **Never raise a cap.** Hard ceilings live in the extension: 100 invites/day, 150 messages/day,
  500 profile visits/day, 1,000 search results/day. No client can raise them and neither can you.
- **Minimum 24 hours between outreach steps.** If the user asks for faster, explain that the
  engine paces anyway and faster sequences get accounts restricted.
- **Copy comes from the profile, not from a template alone.** If message bodies are generic, hand
  off to `linkedin-outreach-writer` first.
- **Report the real numbers.** Never present projected or estimated stats as observed ones. If
  `stats` is missing a field, write `—`.
- **Stop on `CHALLENGE_DETECTED`.** Pause the campaign, tell the user to clear the challenge in
  Chrome, do not resume automatically.
