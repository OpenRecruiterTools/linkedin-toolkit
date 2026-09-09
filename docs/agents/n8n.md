# n8n

HTTP Request nodes, the community node, or the MCP client node.

## Prerequisites

```bash
npx linkedin-toolkit-mcp     # pair the extension once
lit serve --http             # 127.0.0.1:47830
```

## Option 1 — HTTP Request nodes (works on any instance)

One credential, then every action is reachable.

**Credential:** *Header Auth* — Name `Authorization`, Value `Bearer <token>`. The token is
`token` in `~/.linkedin-toolkit/config.json`, or run `lit config get token --reveal`.

**Node:** HTTP Request → POST → `http://127.0.0.1:47830/actions/search.people`, Header Auth
credential, JSON body:

```json
{ "keywords": "CTO fintech London", "count": 50 }
```

Response is the envelope: `{ "ok": true, "data": { … } }` or
`{ "ok": false, "error": { "code", "message", "retryAfter", "howToFix" } }`.

Docker: `127.0.0.1` inside a container is the container. Use `http://host.docker.internal:47830`
on Docker Desktop, or run n8n with `--network host` on Linux.

## Option 2 — the community node

Settings → Community Nodes → install `n8n-nodes-linkedin-toolkit`. Adds typed nodes for search,
profile, invite, message and inbox, plus a **trigger node** fed by the webhooks below.

## Option 3 — MCP Client node

Point n8n's MCP Client Tool node at `http://127.0.0.1:47830/mcp` (Streamable HTTP, bearer auth) to
give an n8n AI Agent every tool at once.

## Webhooks

Set `webhookUrl` and the server POSTs `{ event, payload }` on every event:

```bash
lit config set webhookUrl https://your-n8n/webhook/linkedin-events
```

| Event | Worth automating |
|---|---|
| `invite_accepted` | Draft a first message |
| `reply_received`, `positive_reply` | Route to triage, create a CRM task |
| `campaign_step_done`, `campaign_completed` | Progress and reporting |
| `quota_hit` | Log it — the engine is working as intended |
| `challenge_detected` | **Page someone.** All writes are paused until a human clears it in Chrome |
| `queue_item_added`, `queue_item_sent` | Approval dashboards |
| `campaign_note_truncated` | An invite note was cut to fit LinkedIn's 200 characters — shorten the template |
| `research_progress`, `research_completed` | Research Pack progress |

## Working example

[`examples/n8n/workflow.json`](../../examples/n8n/workflow.json) — importable: accepted invite →
`profile.get` → OpenAI drafts a message → `outreach.message` queues it → Slack asks a human →
approval link → `queue.approve`.

## Do not fully automate this yet

You could delete the approval step. The hard caps in the extension will stop it becoming a
disaster; they will not stop it being embarrassing. Watch a few hundred drafts first.

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
