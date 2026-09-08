# OpenAI Agents SDK

Tools over the HTTP action API.

## Prerequisites

```bash
npx linkedin-toolkit-mcp     # pair the extension once
lit serve --http             # 127.0.0.1:47830
export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.bridge.token' ~/.linkedin-toolkit/config.json)
```

Add `--fake` to `lit serve` to run without a LinkedIn account: real envelopes, real error codes,
synthetic data.

## Config

```bash
npm i @openai/agents zod
```

```ts
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';

const BASE = 'http://127.0.0.1:47830';
const TOKEN = process.env.LINKEDIN_TOOLKIT_TOKEN!;

async function action(name: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/actions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(params),
  });
  const env = await res.json();
  if (!env.ok) throw new Error(`${env.error.code}: ${env.error.message}`);
  return env.data;
}

const searchPeople = tool({
  name: 'linkedin_search_people',
  description: 'Search LinkedIn for people. count is capped at 100; page with the returned nextStart.',
  parameters: z.object({
    keywords: z.string(),
    title: z.string().nullable(),
    location: z.string().nullable(),
    count: z.number().int().max(100).nullable(),
  }),
  execute: (p) => action('search.people', p).then(JSON.stringify),
});

const agent = new Agent({ name: 'LinkedIn Sourcer', tools: [searchPeople] });
console.log((await run(agent, 'Find 20 CTOs at London fintechs')).finalOutput);
```

## Working example

[`examples/openai-agents/`](../../examples/openai-agents/) — five tools, structured error
handling, `dry_run` before the batch, ending in the approval queue.

## What to get right

Put the Copilot behaviour in the **tool description**: say that
`{ "status": "queued", "queueId": … }` is success. Without it, models read a queued write as a
failure and start hunting for another route. There isn't one — the caps and the queue live in the
extension — but the transcript gets much worse.

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
