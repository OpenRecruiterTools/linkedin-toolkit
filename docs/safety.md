# Safety

Read this before you point an agent at your account. It is short and it is the part that matters.

**The honest position first.** LinkedIn's User Agreement prohibits automated access and scraping.
This tool automates LinkedIn. Using it may put your account at risk, and no configuration makes
that risk zero. Everything below reduces it; nothing below removes it. If losing your account
would be a serious problem, do not use this — or any tool like it — on that account.

What this tool does *not* do is equally important: it never bypasses a security measure, never
solves a challenge, never uses a proxy or a residential IP pool, never imports or shares cookies,
and never touches an account other than the one you are already signed into in your own browser.
When LinkedIn puts up a wall, we stop. That is a design decision, not an unimplemented feature.

## The five things that keep accounts alive

### 1. Hard caps that nothing can raise

Enforced in the extension, below every client. The MCP server cannot raise them. An agent cannot
raise them. `config.set` clamps whatever you pass.

| Action | Hard ceiling per day |
|---|---|
| Connection invites | **100** |
| Messages | **150** |
| Profile visits | **500** |
| Search results | **1,000** |

These are ceilings, not recommendations. Your own settings should be well below them —
25 invites a day is a sane number for an established account, and 10–15 for a new one.

### 2. Human pacing

Every action is spaced by a randomised delay (8–15 seconds by default, configurable, jittered so
the intervals are never uniform). Hourly caps sit under the daily ones. Actions only fire inside
your configured business-hours window, on weekdays if you choose. Sequence steps are days apart,
not minutes.

Machine-speed activity is the single loudest signal a LinkedIn account can emit. A human does not
send 40 invites in four minutes at 3am, and neither does this.

### 3. Warm-up

New or dormant accounts ramp over 14 days rather than starting at your configured caps. An account
that has never sent an invite suddenly sending 50 is the classic pattern. Turn warm-up on for any
account that has not been actively used for outreach in the last month.

### 4. Copilot mode

Every invite, message, InMail and comment originating from an agent, the CLI, or a campaign lands
in the approval queue. You see what would be sent, edit it, approve or reject it, in the popup.
Nothing goes out until you say so.

Profile views, follows and likes do not queue. They carry no words of yours and cannot be edited,
so there would be nothing to approve; they are metered against the visit bucket and paced like
everything else, and they go out directly.

Approving is a human action. An agent asking to approve its own queue is refused — `queue.approve`
and `queue.reject` answer `UNAUTHORIZED` from an MCP client unless you have turned Autopilot on.
The popup and `lit queue approve` at your own terminal are you, so both work.

The `cli` origin is asserted by the caller itself, in the `X-LinkedIn-Toolkit-Origin` header on the
request to the local bridge, and it is trusted for one reason: the bearer token that header rides
with is only ever issued over loopback and is stored in a file readable by your account alone, so
anything holding it is already you at your own machine. Everything else arriving over the bridge is
stamped `mcp` — an MCP client cannot promote itself to `popup`, which is the origin the
popup-only actions (Autopilot, the safety caps, mass unfollow) require.

Autopilot exists, and turning it on is a decision only you can make, in the popup — no config
file, no API call, no agent. Turn it on when you have watched a few hundred drafts and trust what
the sequence produces. Approving is still not sending: an approved item waits for the delay, the
window, and the caps.

### 5. Stopping when told to stop

| LinkedIn says | The engine does | Tools return |
|---|---|---|
| **429** rate limited | Exponential backoff, pauses the action class, surfaces `nextAllowedAt` | `RATE_LIMITED` with `retryAfter` |
| **451** security challenge | **Pauses every write immediately**, notifies you in the popup and by webhook, and stays paused | `CHALLENGE_DETECTED` |
| A cap is spent | Refuses the action outright — never a silent partial | `QUOTA_EXCEEDED` with the cap |

A cap unit is **reserved before the request and stays spent when LinkedIn refuses it**. A refused
write may still have been counted at LinkedIn's end, and over-counting our own quota is safe where
under-counting is not. The one exception is a send the engine refused itself, on its own
validation, before anything left the browser — an invitation note over the 200-character limit,
say: nothing reached LinkedIn, so the reservation is handed back.

LinkedIn runs its own allowances underneath ours, and they are not visible through any API. On a
free account the one that bites first is **personalised invitations**: only a handful with a note
each month, after which the invitation is refused whatever your daily cap says. The engine reports
that as `LINKEDIN_ERROR` with advice to send without a note or wait for the reset — it is not a bug
and retrying will not help. Invitation notes themselves are capped at 200 characters by LinkedIn;
aim for 180 or fewer so a rendered name and job title cannot push a template over.

A challenge does not clear itself and the engine will not clear it for you. You go to Chrome,
complete whatever LinkedIn asks, and resume manually. There is no retry loop, no "wait and try
again", no alternate route. That is deliberate: automatic retry after a challenge is precisely how
a warning becomes a restriction.

## Local-first, and what that actually means

- Every LinkedIn request comes from your own Chrome, with your own cookies, IP address and device
  fingerprint, using the same internal endpoints the LinkedIn page itself calls.
- There is no hosted service. Nothing to sign up for, no account, no server holding your session.
- There is no telemetry. The project cannot count its own users.
- Your data — profiles, lists, messages, campaigns — lives in `chrome.storage.local`, IndexedDB,
  and `~/.linkedin-toolkit/toolkit.db` on your machine. Delete the extension and the folder and it
  is gone.
- The only outbound traffic beyond LinkedIn is the one you configure yourself: a webhook URL, or a
  BYOK model provider. Both are off by default. With Ollama, even the model is local.

## Using it with an agent

Agents make this easier to do at volume, which makes it easier to do badly.

- **Keep Copilot on** until you have read a few hundred of the drafts your agent produces. The
  failure mode is not catastrophe, it is fifty slightly-wrong messages sent under your name.
- **Give read-only agents read-only tools.** The
  [Claude Code example](../examples/claude-code/README.md) shows a permissions block that denies
  the write tools entirely. An agent without a tool never has to be told not to use it.
- **Never wrap a write in a retry loop.** Structured errors carry `code`, `retryAfter` and
  `howToFix` so an agent can explain itself instead of hammering. `RATE_LIMITED`,
  `QUOTA_EXCEEDED` and `CHALLENGE_DETECTED` are terminal.
- **Facts only.** All six [skills](../skills/) carry the same guardrail: never state anything about
  a person that did not come from a tool result. An invented detail in an outreach message is worse
  than no personalisation, and it is the one mistake the recipient will remember.
- **Watch the queue, not the logs.** `linkedin_queue_list` is the honest view of what your agent
  wants to do.

## Recommended settings

| Account | Invites/day | Messages/day | Warm-up | Autopilot |
|---|---|---|---|---|
| Brand new, low activity | Don't. Use it normally for a month first. | | | |
| Established, first automation | 10–15 | 20 | on | off |
| Established, running for months | 20–25 | 40 | off | off, or on for one sequence you trust |
| Sales Navigator / Recruiter | 25–30 | 50 | off | as above |

And: do not run two automation tools on one account. They cannot see each other's pacing, so the
account sees the sum, and the sum is what gets restricted.

## Signs to stop

Stop and go quiet for a week if you see any of these:

- A security challenge (the engine will have paused already — leave it paused).
- "You've reached the weekly invitation limit" — you are being throttled at the account level.
- Invite acceptance rate falling below 10% — LinkedIn weighs ignored invites against you.
- Anyone reporting your message as spam.
- Search results suddenly limited to a fraction of the usual count.

## Data protection

Profiles, messages and Research Packs are personal data about real people. Where you are subject
to GDPR, the UK GDPR, CCPA or an equivalent, exporting a profile makes you a controller of that
data with the obligations that follow: a lawful basis, a retention period, and an answer if
someone asks what you hold. That the data was publicly visible does not change this.

Practically: keep only what you will actually use, delete lists when a search ends, and do not
build a permanent shadow CRM of people who never agreed to be in one.

## Full disclaimer

See the [Disclaimer section of the README](../README.md#disclaimer). In short: this software is
provided as is, without warranty; LinkedIn's User Agreement prohibits automation; using this may
result in restriction or permanent loss of your account; you are solely responsible for what you
do with it; and the authors accept no liability for any of it.
