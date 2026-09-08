# Examples

One working example per agent ecosystem. All of them do a variant of the same thing — source
people, look at what came back, draft outreach, land it in the approval queue — so you can read
whichever one is in your language and recognise the shape.

| Example | Stack | Entry point |
|---|---|---|
| [`claude-code/`](claude-code/) | Claude Code | MCP over stdio, `.mcp.json` + a real transcript |
| [`openai-agents/`](openai-agents/) | OpenAI Agents SDK (TypeScript) | HTTP `/actions`, tools as function calls |
| [`vercel-ai/`](vercel-ai/) | Vercel AI SDK, Next.js route handler | HTTP `/actions`, streamed tool calls |
| [`langchain/`](langchain/) | LangChain (Python) | HTTP `/actions`, `@tool` functions |
| [`crewai/`](crewai/) | CrewAI (Python) | HTTP `/actions`, a sourcer and a writer agent |
| [`n8n/`](n8n/) | n8n | Webhook trigger → OpenAI → approve, importable JSON |
| [`cli/`](cli/) | bash + curl + jq | `lit` and raw HTTP |

## Prerequisites

Every example except `claude-code/` talks to the HTTP surface, so start it first:

```bash
npx linkedin-toolkit-mcp   # first run prints a pairing token; paste it into the extension popup
lit serve --http           # Streamable HTTP MCP + /actions + /openapi.json on 127.0.0.1:47830
```

Check it is alive:

```bash
curl -s http://127.0.0.1:47830/health
```

The bearer token is the bridge token in `~/.linkedin-toolkit/config.json`
(`%USERPROFILE%\.linkedin-toolkit\config.json` on Windows):

```bash
export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.bridge.token' ~/.linkedin-toolkit/config.json)
export LINKEDIN_TOOLKIT_URL=http://127.0.0.1:47830
```

## The HTTP shape, once

Every example uses the same two lines underneath whatever framework wraps them:

```
POST http://127.0.0.1:47830/actions/{action}
Authorization: Bearer <token>
Content-Type: application/json

<the action's params object>
```

and gets back the envelope:

```jsonc
{ "id": "…", "ok": true,  "data": { /* … */ }, "rateLimit": { "dailyUsed": 12, "dailyCap": 100, "nextAllowedAt": 0 } }
{ "id": "…", "ok": false, "error": { "code": "RATE_LIMITED", "message": "…", "retryAfter": 900000, "howToFix": "…" } }
```

Action names, parameters and error codes are in [`../docs/actions.md`](../docs/actions.md). The
MCP tool names that map onto them are in [`../docs/tools.md`](../docs/tools.md). Nothing in these
examples invents a name.

Full generated schema: `curl -s http://127.0.0.1:47830/openapi.json`.

## What every example gets right, and you should too

- **Reads before writes.** Call `status.get` first. If `connected` is false or a `challenge` is
  set, stop — do not queue work that will stall.
- **Writes queue.** In Copilot mode (the default) `outreach.invite` and `outreach.message` return
  `{ "status": "queued", "queueId": "…" }`, not `sent`. That is the correct outcome, not an error.
  A human approves in the popup, or via `queue.approve`.
- **`dry_run` first.** Every write action takes it and returns `{ "status": "dryRun", "wouldSend": … }`.
- **Errors are terminal, not retryable.** `RATE_LIMITED` carries `retryAfter`; `QUOTA_EXCEEDED`
  means the day is done; `CHALLENGE_DETECTED` means stop everything and tell the human. None of
  them are a reason to loop.
- **No headless browser anywhere.** There is no Playwright, Puppeteer, or CDP in this repo, and
  there never will be. The whole point is that the traffic comes from a real Chrome session that a
  real person is signed in to.

## Demo mode

You do not need a LinkedIn account to run these. `lit serve --http --fake` starts the server with
the fake extension client used by the test suite: real envelopes, real error codes, real rate-limit
headers, synthetic profiles. Every example in this folder runs end to end against it.
