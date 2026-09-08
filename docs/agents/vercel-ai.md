# Vercel AI SDK

Tools over the HTTP action API, in a route handler or a script.

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
npm i ai @ai-sdk/openai zod
```

```ts
import { openai } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
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

const tools = {
  linkedin_get_status: tool({
    description: 'Quota, mode, business hours, queue depth. Call before anything else.',
    inputSchema: z.object({}),
    execute: () => action('status.get'),
  }),
  linkedin_search_people: tool({
    description: 'Search LinkedIn for people. count capped at 100; page with nextStart.',
    inputSchema: z.object({
      keywords: z.string(),
      title: z.string().optional(),
      location: z.string().optional(),
      count: z.number().int().max(100).optional(),
    }),
    execute: (p) => action('search.people', p),
  }),
};

const result = streamText({ model: openai('gpt-4.1'), tools, prompt: 'Find 20 CTOs at London fintechs' });
```

`inputSchema`, not `parameters` — AI SDK 5 renamed it, and a v4-shaped tool silently never fires.

## Working example

[`examples/vercel-ai/`](../../examples/vercel-ai/) — a full Next.js route handler with six tools.

## Deployment

The toolkit listens on localhost, so a route handler running on Vercel cannot reach it — there is
no hosted session anywhere in this project, by design. This pattern is for locally run apps. If
you genuinely need a remote agent, see [chatgpt-connector.md](chatgpt-connector.md) for the tunnel
approach and its risks.

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
