# MCP tool reference

> **Hand-written for now.** `mcp-server/scripts/gen-docs.ts` generates this file from
> `src/contract.ts` once the server is built, and will overwrite it. Until then, treat
> [`actions.md`](actions.md) as the source of truth and this as its MCP-shaped view. If the two
> disagree, `actions.md` wins.

Every tool is a thin wrapper over one action. The MCP server does no logic of its own except
`linkedin_query_sql` and `linkedin_sync`, which read and write the local SQLite mirror.

Every tool returns the envelope:

```jsonc
{ "ok": true,  "data": { /* … */ }, "rateLimit": { "hourlyUsed": 3, "hourlyCap": 20, "dailyUsed": 14, "dailyCap": 100, "nextAllowedAt": 0 } }
{ "ok": false, "error": { "code": "RATE_LIMITED", "message": "…", "retryAfter": 900000, "howToFix": "…" } }
```

Every **write** tool takes `dry_run?: boolean` and returns `{ status: "dryRun", wouldSend }` when
set. In Copilot mode — the default — writes return `{ status: "queued", queueId }` instead of
sending. That is success.

## The tools

### Status and configuration

| Tool | Action | What it does |
|---|---|---|
| `linkedin_get_status` | `status.get` | Connection, login, Autopilot, business hours, backoff, challenge, per-action quota, queue depth, campaign counts. **Call this first.** |
| `linkedin_endpoints_check` | `status.get` (`verify: true`) | Self-test every LinkedIn endpoint the extension uses. **Run this first when a tool returns `LINKEDIN_ERROR`.** One read-only call each, reported `ok`, `failed`, `unverified` or `skipped`, with the client version the endpoint table was captured against. Optional `postUrl` also checks reactions. Costs one search and one visit against the daily caps. |

### Search and read

| Tool | Action | What it does |
|---|---|---|
| `linkedin_search_people` | `search.people` | Keyword/title/company/location search. `source`: `search`, `salesnav`, `recruiter`. `count` ≤ 100; page with `nextStart`. |
| `linkedin_get_profile` | `profile.get` | One profile by `url` or `publicId`. `full: true` adds `pageText` and `photoDataUrl` and spends a visit. |
| `linkedin_export_profiles` | `profile.export` | Bulk capture from a list of URLs. Returns `profiles` and `failed`. |
| `linkedin_get_company` | `company.get` | Company page by `url` or `universalName`. |
| `linkedin_get_company_employees` | `company.employees` | Paged employees for a company. |
| `linkedin_get_post_engagers` | `post.engagers` | Likers and commenters for a post URL. `kind`: `likes`, `comments`, `both`. |
| `linkedin_get_group_members` | `group.members` | Paged group members. |
| `linkedin_get_event_attendees` | `event.attendees` | Paged event attendees. |
| `linkedin_get_connections` | `network.connections` | Your own connections, paged. |
| `linkedin_get_connection_status` | `network.status` | Batch `connected` / `pending` / `none`. Call before any invite. |

### Inbox

| Tool | Action | What it does |
|---|---|---|
| `linkedin_get_conversations` | `inbox.threads` | Threads since a timestamp, optionally unread only. |
| `linkedin_get_messages` | `inbox.messages` | Messages in one thread. |

### Lists

| Tool | Action | What it does |
|---|---|---|
| `linkedin_list_create` | `list.create` | Create a named list with tags. |
| `linkedin_list_all` | `list.getAll` | Every list with its count. |
| `linkedin_list_get` | `list.get` | One list's metadata. |
| `linkedin_list_add` | `list.add` | Add profiles or `publicIds`. Deduplicates; returns `added` and `duplicates`. |
| `linkedin_list_members` | `list.members` | Paged members with profile, tags, `contactedBefore`, `signals`. |

### Write — outreach

All of these honour Copilot mode and the hard caps.

| Tool | Action | What it does |
|---|---|---|
| `linkedin_view_profile` | `outreach.view` | Visit a profile so it shows in their "who viewed". Costs visit quota. |
| `linkedin_follow` | `outreach.follow` | Follow without connecting. |
| `linkedin_send_invite` | `outreach.invite` | Connection invite, optional `note` ≤ 300 characters. |
| `linkedin_send_message` | `outreach.message` | Direct message to an existing connection. |
| `linkedin_send_inmail` | `outreach.inmail` | InMail with `subject` and `body`. Needs credits on the account. |
| `linkedin_like_post` | `outreach.like` | Like a post by URL. |
| `linkedin_comment_post` | `outreach.comment` | Comment on a post. Public and permanent — the queue matters most here. |

### Campaigns

| Tool | Action | What it does |
|---|---|---|
| `linkedin_campaign_create` | `campaign.create` | Create from a `steps` array. See [`../sequences/`](../sequences/). |
| `linkedin_campaign_list` | `campaign.getAll` | Every campaign. |
| `linkedin_campaign_get` | `campaign.get` | One campaign with `stats` including `byStep`. |
| `linkedin_campaign_enroll` | `campaign.enroll` | Enroll `publicIds`. Returns `enrolled` and `skipped`. |
| `linkedin_campaign_pause` | `campaign.pause` | Stop scheduling. In-flight steps do not fire. |
| `linkedin_campaign_resume` | `campaign.resume` | Resume from where it stopped. |

### Approval queue

| Tool | Action | What it does |
|---|---|---|
| `linkedin_queue_list` | `queue.list` | Filter by `pending`, `approved`, `rejected`, `sent`. |
| `linkedin_queue_approve` | `queue.approve` | Approve by id, optionally with `edits` per id. |
| `linkedin_queue_reject` | `queue.reject` | Reject by id. |

### Research Pack

| Tool | Action | What it does |
|---|---|---|
| `linkedin_research_resolve` | `research.resolve` | Match rows to profiles or companies, with `confidence` and `candidates`. Dry-run your CSV with this before spending capture quota. |
| `linkedin_research_pack` | `research.pack` | Full pipeline: resolve, gather, signals, pack per row, plus a list. The server waits up to 10 minutes, then returns a `jobId` to poll. |
| `linkedin_research_get` | `research.get` | Poll a job: `status`, `done`, `total`, `packs`. |

### Local data

| Tool | Action | What it does |
|---|---|---|
| `linkedin_sync` | `sync.pull` | Pull everything changed since a timestamp into the local SQLite mirror. |
| `linkedin_query_sql` | *server-local* | `{ sql: string }` — read-only `SELECT` over `~/.linkedin-toolkit/toolkit.db`. Never touches LinkedIn, never spends quota. |

## Examples

### Source and shortlist

```jsonc
// linkedin_get_status
{}
// → { "connected": true, "loggedIn": true, "autopilot": false, "businessHours": true,
//     "quotas": { "search": { "dailyUsed": 0, "dailyCap": 1000, … }, … },
//     "queue": { "pending": 0 }, "campaigns": { "active": 1, "paused": 0 } }

// linkedin_endpoints_check — after a LINKEDIN_ERROR, before anything else
{}
// -> { "endpoints": { "me": "ok", "search": "ok", "memberPosts": "failed",
//                     "groupMembers": "unverified", "reactions": "skipped", ... },
//      "clientVersionCaptured": "1.13.35548", "connected": true, ... }
// "failed" means LinkedIn moved that endpoint, not that the toolkit is broken.

// linkedin_search_people
{ "keywords": "data engineering fintech", "title": "Head of Data Engineering",
  "location": "London", "source": "search", "start": 0, "count": 50 }
// → { "profiles": [ … ], "total": 34, "nextStart": null }

// linkedin_get_connection_status
{ "publicIds": ["l-okafor", "m-castellanos-eng"] }
// → { "statuses": { "l-okafor": "none", "m-castellanos-eng": "connected" } }

// linkedin_list_create
{ "name": "Heads of Data Eng · London", "tags": ["sourced", "data-eng"] }
// → { "listId": "lst_c4d9", "name": "…", "tags": [ … ], "count": 0, "createdAt": 1757289600000 }

// linkedin_list_add
{ "listId": "lst_c4d9", "publicIds": ["l-okafor", "…"] }
// → { "added": 20, "duplicates": 0 }
```

### A write, dry then real

```jsonc
// linkedin_send_invite
{ "publicId": "l-okafor", "note": "Hi Lola — going from 3 to 19 on a platform team…", "dry_run": true }
// → { "status": "dryRun", "wouldSend": { "publicId": "l-okafor", "note": "Hi Lola — …" } }

// linkedin_send_invite
{ "publicId": "l-okafor", "note": "Hi Lola — going from 3 to 19 on a platform team…" }
// → { "status": "queued", "queueId": "q_7a1e" }        ← Copilot mode. Nothing sent.

// linkedin_queue_approve
{ "ids": ["q_7a1e"], "edits": { "q_7a1e": { "note": "Hi Lola — …edited…" } } }
// → { "approved": 1 }
```

### A campaign

```jsonc
// linkedin_campaign_create — steps taken verbatim from sequences/warm-connect.json
{ "name": "Warm connect · Data leads", "listId": "lst_c4d9",
  "steps": [
    { "type": "view" },
    { "type": "wait", "waitMs": 86400000 },
    { "type": "invite", "variants": ["…", "…"] },
    { "type": "branch", "branch": { "on": "accepted", "ms": 604800000,
        "then": [ { "type": "wait", "waitMs": 172800000 }, { "type": "message", "variants": ["…", "…"] } ],
        "else": [ { "type": "wait", "waitMs": 604800000 }, { "type": "follow" } ] } }
  ],
  "settings": { "stopOnReply": true, "autopilot": false } }
// → { "campaignId": "cmp_7f21", "status": "active", … }

// linkedin_campaign_get
{ "campaignId": "cmp_7f21" }
// → { …, "stats": { "enrolled": 27, "sent": 24, "accepted": 9, "replied": 4, "positive": 3,
//                   "byStep": { "2": { "sent": 24, "accepted": 9 }, … } } }
```

### SQL over your own data

`linkedin_query_sql` takes a single parameter, `{ sql: string }`, and reads the local mirror. No
network, no quota, no rate limit.

```jsonc
// linkedin_query_sql
{ "sql": "SELECT company, COUNT(*) AS n FROM profiles GROUP BY 1 ORDER BY n DESC LIMIT 20" }
// → { "rows": [ { "company": "…", "n": 12 }, … ] }
```

```sql
SELECT company, COUNT(*) AS n
FROM profiles
WHERE location LIKE '%London%'
GROUP BY company
ORDER BY n DESC
LIMIT 20;
```

```sql
-- Who accepted but never replied
SELECT p.full_name, p.company, a.created_at
FROM actions a
JOIN profiles p ON p.public_id = a.public_id
WHERE a.action = 'outreach.invite' AND a.accepted = 1
  AND p.public_id NOT IN (SELECT from_public_id FROM messages)
ORDER BY a.created_at DESC;
```

`SELECT` only. Anything else is rejected.

## Errors

| Code | Means | What an agent should do |
|---|---|---|
| `EXTENSION_OFFLINE` | The bridge has no extension attached | Stop. Tell the human to open Chrome and check the popup's pairing. |
| `NOT_LOGGED_IN` | No LinkedIn session in Chrome | Stop. Tell the human to log in. |
| `RATE_LIMITED` | LinkedIn returned 429; the engine is backing off | Stop. Report `retryAfter`. Do not retry. |
| `CHALLENGE_DETECTED` | LinkedIn returned 451 — a security challenge | **Stop everything.** All writes are paused until a human clears it in Chrome. |
| `QUOTA_EXCEEDED` | A daily or hourly cap is spent | Stop for that action type. Report the cap. It cannot be raised. |
| `OUTSIDE_BUSINESS_HOURS` | Outside the configured window | Reads still work. Writes wait. |
| `INVALID_PARAMS` | Failed schema validation | Fix the call. `message` says which field. |
| `NOT_FOUND` | No such profile, list, campaign, or queue item | Check the id came from a tool result. |
| `LINKEDIN_ERROR` | LinkedIn returned something unexpected | Report it. Usually transient; one retry at most. |
| `AI_NOT_CONFIGURED` / `AI_ERROR` | BYOK provider missing or failing | Only affects `ai.complete`. Everything else still works. |
| `UNAUTHORIZED` | Bad bridge token | Re-pair: the token is in `~/.linkedin-toolkit/config.json`. |
| `INTERNAL` | A bug | Please open an issue with the `message`. |

None of these are a reason to loop. `retryAfter` is in milliseconds and is a floor, not a target.

## Resources and prompts

**Resources** — `linkedin://status`, `linkedin://profile/{publicId}`, `linkedin://list/{listId}`,
`linkedin://queue`. Hosts that support MCP resources can attach these as context without a tool
call.

**Prompts** — `source-candidates` (args `brief`, `count`), `write-opener` (args `publicId`,
`tone`), `triage-inbox` (args `since`). They arrive with the server, so they need no setup — in
Claude Code they appear as `/source-candidates` and friends.

For richer, opinionated versions of the same jobs, use the [skills](../skills/): they carry the
guardrails and the output formats as well as the tool sequence.
