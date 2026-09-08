# Sequences

Twenty campaign templates. Each one is a JSON file you can pass straight to
`campaign.create` (MCP tool `linkedin_campaign_create`, CLI `lit campaign create --from`).

Every template is written the same way, and the rules are not decoration — they are what
separates a sequence that gets replies from one that gets your account restricted:

- **A soft first touch.** Profile view, often a follow, before any invite. It is what a human does.
- **Two variants on every invite and message step.** The engine A/B tests them and reports which
  won per step, so you learn instead of guessing.
- **At least 24 hours between outreach steps**, usually more. Enforced by the validator.
- **A branch on acceptance.** Accepted people get the conversation; the rest get one warm,
  non-intrusive touch and are left alone.
- **A graceful exit.** Every sequence ends by saying it will stop. None of them end by asking again.
- **`stopOnReply: true`, `autopilot: false`.** A reply ends the sequence for that person. Nothing
  sends without human approval until you turn Autopilot on yourself, in the popup.

## The templates

| File | Name | For | Steps |
|---|---|---|---|
| [`warm-connect.json`](warm-connect.json) | Warm connect | The default. No specific trigger, no hurry. | 12 |
| [`connect-then-message.json`](connect-then-message.json) | Connect then message | Shortest respectable sequence: four touches. | 10 |
| [`recruiter-passive-candidate.json`](recruiter-passive-candidate.json) | Recruiter — passive candidate | People who are not looking. Slow, respectful. | 14 |
| [`recruiter-active-candidate.json`](recruiter-active-candidate.json) | Recruiter — active candidate | Open-to-work. Fast, role-first, asks for the call. | 12 |
| [`exec-search-confidential.json`](exec-search-confidential.json) | Executive search — confidential | Senior mandates where a leak is the failure mode. | 11 |
| [`founder-to-founder.json`](founder-to-founder.json) | Founder to founder | Peer trade, helpful before it asks. | 14 |
| [`sales-post-engager.json`](sales-post-engager.json) | Sales — post engager | Liked or commented on a post about your problem. | 12 |
| [`sales-event-attendee.json`](sales-event-attendee.json) | Sales — event attendee | Shared conference or webinar. | 12 |
| [`sales-competitor-follower.json`](sales-competitor-follower.json) | Sales — competitor follower | Following a competitor. Never names them. | 14 |
| [`sales-job-change-trigger.json`](sales-job-change-trigger.json) | Sales — job change trigger | Started a new role in the last 90 days. | 12 |
| [`partnership.json`](partnership.json) | Partnership outreach | Integrations, co-marketing, referral deals. | 14 |
| [`investor-intro.json`](investor-intro.json) | Investor introduction | Cold to investors. Number first, no ask. | 14 |
| [`podcast-guest.json`](podcast-guest.json) | Podcast guest invite | Books guests with a named episode idea. | 14 |
| [`speaker-invite.json`](speaker-invite.json) | Speaker invite | Date, audience and format in the first message. | 14 |
| [`reactivation-old-connection.json`](reactivation-old-connection.json) | Reactivation — dormant contact | People you knew once. Acknowledges the gap. | 12 |
| [`referral-ask.json`](referral-ask.json) | Referral ask | Asks for a name, not an introduction. | 12 |
| [`hiring-manager-intro.json`](hiring-manager-intro.json) | Hiring manager intro | Candidate going direct, proof of work first. | 14 |
| [`agency-bd.json`](agency-bd.json) | Agency business development | Result for a comparable client, free teardown. | 14 |
| [`saas-trial-nudge.json`](saas-trial-nudge.json) | SaaS trial nudge | Trial signups who stopped. Asks what broke. | 12 |
| [`community-invite.json`](community-invite.json) | Community invite | Names who is in the room and what happens there. | 14 |

## Using one

```bash
# CLI
lit campaign create --from sequences/sales-job-change-trigger.json --list "New VPs Sept"
```

```jsonc
// MCP: linkedin_campaign_create
{
  "name": "New VPs Sept",
  "steps": [ /* the "steps" array from the file, verbatim */ ],
  "listId": "lst_a1b2",
  "settings": { "stopOnReply": true, "autopilot": false }
}
```

Or open the popup's Campaigns tab and import the file.

Edit the copy before you send it. These templates are a structure and a tone, not a script — the
variants are deliberately generic so that they are obviously worth replacing with something true
about the person you are writing to. `linkedin-outreach-writer` will rewrite them per profile.

## The step shape

Steps mirror the `Step` type in [`../docs/actions.md`](../docs/actions.md):

```jsonc
{ "type": "view" }
{ "type": "follow" }
{ "type": "like" }                              // likes the enrollee's most recent post
{ "type": "wait", "waitMs": 86400000 }          // one day
{ "type": "invite",  "variants": ["A", "B"] }   // note; 300 characters hard limit
{ "type": "message", "variants": ["A", "B"] }
{ "type": "inmail",  "subject": "…", "variants": ["A", "B"] }
{ "type": "branch", "branch": {
    "on": "accepted",        // or "replied" | "notAcceptedAfterMs"
    "ms": 604800000,         // how long to wait for the condition
    "then": [ /* steps */ ],
    "else": [ /* steps */ ] } }
```

`note` and `body` exist on the `Step` type for hand-built single-variant steps. Shipped templates
use `variants` instead and never set both — the validator rejects that.

**Variables** are `{{field|fallback}}` and the fallback is mandatory in shipped templates:
`{{firstName|there}}`, `{{company|your company}}`, `{{title|your role}}`, `{{fullName|…}}`,
`{{lastName|…}}`, `{{headline|…}}`, `{{location|…}}`. A missing field with no fallback renders as
an empty gap in a real person's inbox, which is worse than not personalising at all.

**Already connected?** These templates all begin with an invite. When an enrollee is already a
first-degree connection the engine skips the invite and treats the acceptance branch as taken —
so `reactivation-old-connection` and `referral-ask` work on connections and non-connections alike.

**No `comment` steps ship in any template**, though the step type exists. An automated comment
written from a template is spam by construction, and it is public. If you want auto-comment, use
the BYOK provider in the popup so the comment is at least written against the actual post.

## Validating

```bash
node sequences/validate.mjs                 # all templates
node sequences/validate.mjs my-new-one.json # one file
```

Zero dependencies — it runs in CI before anything is installed. It checks
[`schema.json`](schema.json) (JSON Schema 2020-12) plus the house rules a schema cannot express:
exactly two variants per outreach step, variants not identical, 300-character ceilings, a
`|fallback` on every variable, `autopilot: false`, `stopOnReply: true`, at least one branch, at
least one outreach step, no `note`/`body` alongside `variants`, kebab-case filenames, and no two
outreach steps closer than 24 hours on the same path.

## Contributing a template

Sequences are the easiest useful contribution to this repo. Copy the closest existing file, change
the copy, run the validator, open a PR. What makes one worth merging:

- A **specific audience** that isn't already covered. "Sales" is not an audience; "people who
  starred your repo" is.
- **Copy a real person would send.** If you would not press send on it yourself, it is not ready.
- **A reason for every wait.** If you cannot say why a step is four days rather than two, it
  probably should not be there.

Ban list, enforced in review rather than by the validator: "I hope this message finds you well",
"I came across your profile", "quick question", "just following up", "circling back", and anything
that opens by complimenting the recipient's profile.
