# n8n

A workflow that turns an accepted invite into a drafted first message, and puts a human in front
of it before anything goes out.

```
LinkedIn Toolkit webhook ──▶ invite_accepted? ──▶ profile.get ──▶ OpenAI drafts ──▶ outreach.message (QUEUES)
                                                                                          │
                                                                              Slack: "approve?" with queueId
                                                                                          │
                             human clicks ──▶ /webhook/linkedin-approve ──▶ queue.approve ──▶ confirm
```

Nothing is sent by the workflow. `outreach.message` in Copilot mode returns
`{ "status": "queued", "queueId": "…" }`, and even after `queue.approve` the extension still
paces the send: jittered delay, business hours, hourly and daily caps.

## Setup

**1. Server**

```bash
npx linkedin-toolkit-mcp        # pair the extension once
lit serve --http                # 127.0.0.1:47830
```

**2. Import** `workflow.json` — n8n → Workflows → Import from File.

**3. Two credentials**

| Credential | Type | Value |
|---|---|---|
| `LinkedIn Toolkit bearer token` | Header Auth | Name `Authorization`, Value `Bearer <token>` |
| `OpenAI account` | OpenAI API | your key |

The token is `token` in `~/.linkedin-toolkit/config.json`
(`%USERPROFILE%\.linkedin-toolkit\config.json` on Windows), or run `lit config get token --reveal`.

**4. Point the toolkit at the webhook**

```bash
lit config set webhookUrl https://your-n8n/webhook/linkedin-events
```

Or set `webhookUrl` in `~/.linkedin-toolkit/config.json`.

**5. Set `N8N_WEBHOOK_BASE`** in your n8n environment so the approval link in the Slack message
resolves. Swap the Slack node for email, Telegram, Discord, or an n8n Form — anything that puts a
human in the loop.

If n8n runs in Docker and the toolkit runs on the host, `127.0.0.1:47830` is the container, not
your machine. Use `http://host.docker.internal:47830` on Docker Desktop, or run n8n with
`--network host` on Linux.

## Events you can trigger on

The webhook receives `{ event, payload }` for:

| Event | Payload | Worth automating |
|---|---|---|
| `invite_accepted` | `{ publicId, campaignId? }` | This workflow |
| `reply_received` | `{ threadId, publicId, snippet }` | Route to a triage flow |
| `positive_reply` | `{ threadId, publicId, snippet }` | Create a CRM task, notify the owner |
| `campaign_step_done` | `{ campaignId, stepIndex, publicId }` | Progress tracking |
| `campaign_completed` | `{ campaignId }` | Report |
| `quota_hit` | `{ kind, cap }` | Log it; nothing to fix, the engine is working |
| `challenge_detected` | `{ detectedAt }` | **Page someone.** Every write pauses until a human clears it in Chrome |
| `queue_item_added` / `queue_item_sent` | `{ id, action, publicId }` | Approval dashboards |
| `research_progress` / `research_completed` | `{ jobId, done, total, listId }` | Research Pack progress |

## Any action, from any node

Everything is the same HTTP call, so a plain HTTP Request node reaches the whole surface:

```
POST http://127.0.0.1:47830/actions/{action}
Authorization: Bearer <token>
{ …params… }
```

`search.people`, `post.engagers`, `list.add`, `campaign.enroll`, `inbox.threads`, `research.pack` —
all of them are in [`../../docs/actions.md`](../../docs/actions.md). `GET /openapi.json` gives you
the generated OpenAPI 3.1 document if you would rather import the whole surface at once.

The dedicated community node `n8n-nodes-linkedin-toolkit` adds typed nodes and a trigger node
fed by these same webhooks. This example uses HTTP Request nodes so it works on any n8n instance
without installing anything.

## A word on autonomy

You could delete the Slack node and the approval webhook and let this run unattended. Please do
not — at least not until you have watched a few hundred of its drafts.

The queue exists because an agent writing to a real person's inbox under your name, at scale,
with no human in the loop, is how accounts get restricted and reputations get spent. The hard
caps in the extension will stop it becoming a disaster. They will not stop it being embarrassing.
