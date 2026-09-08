# OpenAI Agents SDK

A sourcing agent with five LinkedIn Toolkit tools, wired over the HTTP action API.

## Run

```bash
# 1. server
npx linkedin-toolkit-mcp        # pair the extension once
lit serve --http --fake         # drop --fake to use a real LinkedIn session

# 2. agent
npm install
export OPENAI_API_KEY=sk-...
export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.token' ~/.linkedin-toolkit/config.json)
npx tsx sourcing-agent.ts "Heads of data engineering at Series B fintechs in London"
```

On Windows PowerShell:

```powershell
$env:LINKEDIN_TOOLKIT_TOKEN = (Get-Content "$env:USERPROFILE\.linkedin-toolkit\config.json" | ConvertFrom-Json).token
```

## What it shows

- **One `action()` helper** for all five tools. The whole integration is the fetch call and the
  envelope unwrap in [`sourcing-agent.ts`](sourcing-agent.ts); everything else is tool metadata.
- **Structured errors passed straight to the model.** `RATE_LIMITED`, `QUOTA_EXCEEDED`,
  `CHALLENGE_DETECTED` and friends arrive with `message` and `howToFix`, so the agent explains
  what happened rather than retrying into a wall.
- **The write tool's description tells the model that `queued` is success.** Without that line
  models treat Copilot mode as a failure and start looking for a way around it. There isn't one —
  the caps and the queue live in the extension — but you get a nicer transcript.
- **`dry_run` before the batch.** The agent shows the first invite verbatim before queuing eight.

## Adding more tools

Every action in [`../../docs/actions.md`](../../docs/actions.md) is `POST /actions/{action}` with
the params as the body. Adding `post.engagers`, `list.create`, or `research.pack` is a `tool({...})`
block and a zod schema — no client library needed.

Once `linkedin-toolkit` is published to npm the same thing is shorter:

```ts
import { LinkedInToolkit } from 'linkedin-toolkit';
const toolkit = new LinkedInToolkit({ baseUrl: process.env.LINKEDIN_TOOLKIT_URL, token: process.env.LINKEDIN_TOOLKIT_TOKEN });
const agent = new Agent({ name: 'LinkedIn Sourcer', tools: toolkit.openaiTools() });
```

This example uses raw HTTP deliberately, so it runs against any version of the server and shows
you exactly what is on the wire.
