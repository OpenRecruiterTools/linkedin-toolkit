# n8n-nodes-linkedin-toolkit

The n8n community node for [LinkedIn Toolkit](https://github.com/FormatixAI/linkedin-toolkit).
Two nodes and one credential: every action of the local HTTP API, and a trigger fed by the
server's webhooks.

## Install

**Settings → Community Nodes → Install** `n8n-nodes-linkedin-toolkit`.

## Prerequisites

```bash
npx linkedin-toolkit-mcp     # pair the extension once
lit serve --http             # 127.0.0.1:47830
```

Add `--fake` to `lit serve` to build and test a workflow without a LinkedIn account: real
envelopes, real error codes, invented data.

## Credential

**LinkedIn Toolkit API**

| Field | Value |
|---|---|
| Base URL | `http://127.0.0.1:47830` |
| Token | the `token` field in `~/.linkedin-toolkit/config.json`, or `lit config get token --reveal` |

The token is sent as `Authorization: Bearer …`. The credential test hits `/health`, which needs no
token, so a passing test proves the URL is reachable — which is the failure worth catching first.

**Docker:** `127.0.0.1` inside a container is the container. Use `http://host.docker.internal:47830`
on Docker Desktop, or run n8n with `--network host` on Linux.

## LinkedIn Toolkit node

Pick a **Resource** (the action namespace — Search, Profile, Outreach, Inbox, List, Campaign,
Queue, Research, …) and an **Operation** (the action). Required fields appear directly; everything
else, including **Dry Run** on write operations, lives in **Additional Fields**.

Field conventions:

- a list of ids is a comma-separated string — `ada-lovelace, grace-hopper`
- a structured parameter (campaign `Steps`, `Profiles`, research `Rows`, queue `Edits`) is a JSON
  field
- an empty optional is not sent, so leaving a field blank is the same as not setting it

The node outputs the envelope's `data` by default; switch on **Return the Full Envelope** for
`{id, ok, data}`. An engine failure throws with the code and `howToFix`; turn on n8n's *Continue On
Fail* to get `{error, message, howToFix}` as an item instead.

Writes return `{"status": "queued", "queueId": …}` while Copilot mode is on. **That is success** —
a human approves them in the extension popup.

## LinkedIn Toolkit Trigger node

A webhook trigger. Copy the node's Production URL and point the server at it:

```bash
lit config set webhookUrl https://your-n8n/webhook/linkedin-events
```

The server POSTs `{ event, payload, at }` and retries at 1 s, 5 s and 25 s. Select the events you
care about, or leave the list empty for all eleven:

| Event | Worth automating |
|---|---|
| `invite_accepted` | Draft a first message |
| `reply_received`, `positive_reply` | Route to triage, create a CRM task |
| `campaign_step_done`, `campaign_completed` | Progress and reporting |
| `quota_hit` | Log it — the engine is working as intended |
| `challenge_detected` | **Page someone.** All writes are paused until a human clears it in Chrome |
| `queue_item_added`, `queue_item_sent` | Approval dashboards |
| `research_progress`, `research_completed` | Research Pack progress |

A delivery whose event is filtered out is answered — so the server does not retry — but does not
start the workflow.

**The webhook is unauthenticated.** Like every n8n webhook it accepts any POST that reaches its
URL, and the toolkit server sends no signature to check. On a laptop that is fine: the URL is
localhost or a private n8n. If you expose it, anything that learns the URL can inject an event, so
put your own gate in front of it — n8n's Header Auth on the node, or a reverse proxy — and treat
the payload as untrusted input rather than as a fact about your LinkedIn account.

## What you cannot change from here

- **Hard caps** live in the extension: 100 invites, 150 messages, 500 profile visits and 1,000
  search results per day. No field in this node raises them.
- **Copilot mode** is on by default and the approval queue cannot be bypassed by a workflow.

You could delete the approval step from a workflow. The hard caps will stop it becoming a disaster;
they will not stop it being embarrassing. Watch a few hundred drafts first.

## Development

```bash
npm run gen     # rebuild the action table from mcp-server/openapi.json
npm run build   # tsc + copy the icons into dist
npm test        # vitest
```

`nodes/LinkedInToolkit/actions.generated.ts` is generated and committed; a test fails if it is
stale, so the node cannot quietly fall behind the action contract.

## Licence

MIT.
