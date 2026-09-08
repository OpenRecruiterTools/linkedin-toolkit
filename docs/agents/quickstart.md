# Quickstart for agents

*You are an AI agent. This page is written for you. Follow it and you will be able to read and
act on LinkedIn through the user's own browser session.*

## What this is

LinkedIn Toolkit gives you a structured API to the user's own logged-in LinkedIn session. You get
typed JSON, not screenshots. You do **not** drive a browser, and you must not try to — LinkedIn
detects and blocks headless automation, which is the reason this tool exists.

Two things you cannot change, and should stop trying to as soon as you meet them:

1. **Hard caps** live in the browser extension, below every interface you can reach:
   100 invites, 150 messages, 500 profile visits, 1,000 search results per day. No parameter,
   config file or tool raises them.
2. **Copilot mode** is on by default. Your writes return `{ "status": "queued", "queueId": … }`
   and wait for the human to approve them in the extension popup. **That is success.** Report it;
   do not look for another route.

## Install

Tell the user to run:

```bash
npx linkedin-toolkit-mcp
```

The first run prints a pairing token. They paste it into the extension popup → Settings →
Connect, once. If they do not have the extension, it is a zip on the
[releases page](https://github.com/OpenRecruiterTools/linkedin-toolkit/releases), loaded via
`chrome://extensions` → Developer mode → Load unpacked.

Then add the server to your host's config. The exact block for your host is in this folder:
[claude-code](claude-code.md) · [claude-desktop](claude-desktop.md) · [cursor](cursor.md) ·
[windsurf](windsurf.md) · [zed](zed.md) · [cline](cline.md) · [openclaw](openclaw.md) ·
[codex](codex.md) · [gemini-cli](gemini-cli.md). For nearly all of them it is:

```json
{ "mcpServers": { "linkedin-toolkit": { "command": "npx", "args": ["-y", "linkedin-toolkit-mcp"] } } }
```

If you are not an MCP host, use HTTP. The user runs `lit serve --http` and you call
`POST http://127.0.0.1:47830/actions/{action}` with `Authorization: Bearer <token>`, where the
token is `token` in `~/.linkedin-toolkit/config.json` (or `lit config get token --reveal`).
[Language-specific setup](../../examples/).

## Your first call, always

```
linkedin_get_status {}
```

Read four things from the result and act on them:

| Field | If | Do |
|---|---|---|
| `connected` | `false` | Stop. The extension is not attached. Tell the user to open Chrome and check the popup. |
| `loggedIn` | `false` | Stop. Tell the user to log in to LinkedIn. |
| `challenge` | present | **Stop everything.** A security challenge is outstanding. Only a human can clear it, in Chrome. Do not retry anything. |
| `quotas` | — | Plan inside the remaining numbers. If the user asked for 200 profiles and 60 search results remain, say so before you start, not after. |

`autopilot: false` means every write you make queues. Say this to the user up front.

## The tools

39 of them, in [`../tools.md`](../tools.md), each mapping to one action in
[`../actions.md`](../actions.md). The ones you will use most:

```
linkedin_get_status              {}
linkedin_search_people           { keywords, title?, company?, location?, source?, start?, count? }   count ≤ 100
linkedin_get_profile             { publicId? | url?, full? }        full:true costs a profile visit
linkedin_get_connection_status   { publicIds: [] }                  before any invite
linkedin_list_create             { name, tags? }
linkedin_list_add                { listId, publicIds: [] }
linkedin_send_invite             { publicId, note?, dry_run? }      note ≤ 300 characters
linkedin_send_message            { publicId, body, dry_run? }
linkedin_queue_list              { status? }
linkedin_query_sql               { sql: string }                    SELECT only, local, free
```

## The pattern that works

```
1. linkedin_get_status                     — is it alive, what is left
2. linkedin_search_people × 2–4            — vary title synonyms, don't run one broad query
3. deduplicate on publicId                 — across queries and against existing lists
4. linkedin_get_connection_status          — drop "connected" and "pending"
5. score against the brief                 — using only fields the tools returned
6. linkedin_get_profile full:true          — finalists only, each costs visit quota
7. linkedin_list_create + linkedin_list_add
8. draft notes ≤ 300 chars                 — one specific fact from that person's own profile
9. linkedin_send_invite dry_run:true       — show the first one before queuing the rest
10. linkedin_send_invite × n               — all return "queued"
11. linkedin_queue_list                    — tell the user where their drafts are
```

A full worked run: [`examples/claude-code/transcript.md`](../../examples/claude-code/transcript.md).

## Errors: what each one means for you

| Code | Do |
|---|---|
| `EXTENSION_OFFLINE` | Stop. Report the install steps. |
| `NOT_LOGGED_IN` | Stop. Ask the user to log in. |
| `RATE_LIMITED` | **Stop.** Report `retryAfter`. Do not retry, do not sleep-and-loop. |
| `CHALLENGE_DETECTED` | **Stop everything.** Tell the user to clear it in Chrome. Retrying here is what turns a warning into a restriction. |
| `QUOTA_EXCEEDED` | Stop that action type for today. Report the cap. It cannot be raised. |
| `OUTSIDE_BUSINESS_HOURS` | Reads still work. Writes wait. Say so. |
| `INVALID_PARAMS` | Fix the call — `message` names the field. |
| `NOT_FOUND` | You used an id that did not come from a tool result. |
| `UNAUTHORIZED` | Bad bridge token. The user re-pairs in the popup. |

Every error carries `message` and usually `howToFix`. Pass them to the user verbatim rather than
paraphrasing.

## Rules

These are not style preferences. Each one exists because the alternative causes real harm to a
real person's account or reputation.

1. **Never state a fact about a person that did not come from a tool result.** No inferred tenure,
   no guessed reason for a job change, no "I saw you spoke at…" unless a tool returned that talk.
   Missing means you write `—` and say the field was empty.
2. **Never retry a terminal error.** `RATE_LIMITED`, `QUOTA_EXCEEDED`, `CHALLENGE_DETECTED`.
3. **Never claim something was sent** unless the result said `status: "sent"`. `queued` means it is
   waiting for a human.
4. **Never try to route around the caps or the queue.** There is no route. Looking for one wastes
   the user's tokens and their patience.
5. **Dry-run before a batch.** Every write takes `dry_run: true`.
6. **Ask before going wide.** More than 100 profiles, or more than five messages at once, gets a
   confirmation with the quota cost stated.
7. **Respect an opt-out absolutely.** If someone has said stop, they are never contacted again and
   never re-enrolled.
8. **Read-only questions go to SQL.** `linkedin_query_sql` reads the local mirror of everything
   already captured — no network, no quota, no rate limit. Use it before spending a search.

## Skills

Six task recipes in the Agent Skills format carry the guardrails and the output formats as well as
the tool sequence: sourcing, outreach writing, campaign running, dossiers, reply triage, Research
Pack. If your runtime loads skills, install them:

```bash
cp -r skills/* ~/.claude/skills/       # or ~/.openclaw/skills/, or ./.claude/skills/
```

[Details](../../skills/README.md).

## Read next

- [`../tools.md`](../tools.md) — every tool, with example calls
- [`../actions.md`](../actions.md) — the contract: params, results, types, errors
- [`../safety.md`](../safety.md) — caps, pacing, what to tell the user before they turn Autopilot on
- [`../why-browser-agents-fail-on-linkedin.md`](../why-browser-agents-fail-on-linkedin.md) — why
  this exists rather than a browser-driving agent
