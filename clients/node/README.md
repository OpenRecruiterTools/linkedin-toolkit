# linkedin-toolkit (Node)

The typed Node client for [LinkedIn Toolkit](https://github.com/FormatixAI/linkedin-toolkit), plus
ready-made tool sets for the OpenAI SDKs, the Vercel AI SDK and LangChain.js.

It talks to the local HTTP API that `lit serve --http` exposes on `127.0.0.1:47830`. Nothing leaves
your machine except the LinkedIn calls your own Chrome makes.

```bash
npm i linkedin-toolkit
```

## Prerequisites

```bash
npx linkedin-toolkit-mcp     # pair the extension once
lit serve --http             # 127.0.0.1:47830
```

Add `--fake` to `lit serve` to run without a LinkedIn account: real envelopes, real error codes,
invented data.

## Use it

```ts
import { LinkedInToolkit } from 'linkedin-toolkit';

const client = new LinkedInToolkit();          // finds the URL and token for you

const status = await client.statusGet();
const { profiles } = await client.searchPeople({ keywords: 'CTO fintech London', count: 25 });
const invite = await client.outreachInvite({ publicId: profiles[0].publicId, note: 'Hello.' });

invite.status; // 'queued' — a human approves it in the extension popup. That is success.
```

One method per action, named by flattening the action: `search.people` → `searchPeople`,
`network.unfollowCount` → `networkUnfollowCount`. Params and results are typed from the same zod
contract the server validates against, so a wrong field name is a compile error.

`call(action, params)` is the untyped escape hatch; `callTool(name, args)` reaches the three tools
that are not a bare action (`linkedin_query_sql`, `linkedin_sync`, `linkedin_research_pack`).

## Configuration

Nothing is required. In order:

1. `new LinkedInToolkit({ baseUrl, token })`
2. `LINKEDIN_TOOLKIT_URL` / `LINKEDIN_TOOLKIT_TOKEN`
3. `~/.linkedin-toolkit/server.json` — the port a running `lit serve` actually bound
4. `~/.linkedin-toolkit/config.json` — the pairing token, and the configured port
5. `http://127.0.0.1:47830`

`LINKEDIN_TOOLKIT_HOME` moves the directory, as it does for the server. `client.config` says which
source each value came from.

## Errors

Every failure — transport, auth, params, engine — rejects with `LinkedInToolkitError`:

```ts
try {
  await client.outreachInvite({ publicId: 'someone' });
} catch (err) {
  if (err instanceof LinkedInToolkitError) {
    err.code;        // 'RATE_LIMITED' | 'CHALLENGE_DETECTED' | …
    err.howToFix;    // pass this to the user verbatim
    err.retryAfter;  // milliseconds, when the server said
    err.terminal;    // true for RATE_LIMITED, QUOTA_EXCEEDED, CHALLENGE_DETECTED, NOT_LOGGED_IN
  }
}
```

**This client never retries.** Half of these codes are terminal, and retrying after a challenge is
the specific behaviour that turns a LinkedIn warning into a restriction.

## Tool definitions

`client.tools()` returns the same 39 definitions the MCP server advertises — name, description and
a JSON Schema for the arguments — as static data, so it works with the server stopped.

### OpenAI (Chat Completions, Assistants)

```ts
import { toOpenAITools, runOpenAIToolCall } from 'linkedin-toolkit';

const tools = toOpenAITools(client);                        // all 39
const readOnly = toOpenAITools(client, { readOnly: true });  // cannot send anything

for (const call of message.tool_calls ?? []) {
  const result = await runOpenAIToolCall(client, call);      // Chat Completions or Responses shape
}
```

### OpenAI Agents SDK

Different shape — `tool()` wants zod and an `execute`, and handing it the Chat Completions shape
fails quietly:

```ts
import { Agent, run, tool } from '@openai/agents';
import { toOpenAIAgentsTools } from 'linkedin-toolkit';

const agent = new Agent({
  name: 'LinkedIn Sourcer',
  tools: toOpenAIAgentsTools(client).map(tool),
});
```

`strict: false` is set on each one: strict mode requires every property to be sent, and most
actions here have genuinely optional filters.

### Vercel AI SDK

```ts
import { toVercelAITools } from 'linkedin-toolkit';

const result = streamText({ model, tools: toVercelAITools(client), prompt: '…' });
```

Each tool carries both `parameters` (AI SDK v4) and `inputSchema` (v5) pointing at the same zod
schema, so the same record works on either major version. `ai` is an optional peer dependency and
is never imported.

### LangChain.js

```ts
import { toLangChainTools } from 'linkedin-toolkit';

const tools = await toLangChainTools(client);   // DynamicStructuredTool[]
```

Async because `@langchain/core` is an optional peer dependency, imported lazily.
`toLangChainToolSpecs(client)` is the synchronous, dependency-free equivalent if you would rather
construct the tools yourself.

### Narrowing the tool set

All four adapters take the same filter:

```ts
toOpenAITools(client, { readOnly: true });                       // no writes at all
toOpenAITools(client, { include: ['linkedin_search_people'] });
toOpenAITools(client, { exclude: ['linkedin_send_inmail'] });
```

## What you cannot change from here

- **Hard caps** live in the extension: 100 invites, 150 messages, 500 profile visits and 1,000
  search results per day. No parameter in this package raises them.
- **Copilot mode** is on by default. Writes return `{ status: 'queued', queueId }` and wait for a
  human. Report that as success.

## Regenerating

`src/contract.ts`, `src/methods.ts` and `src/tools.generated.ts` are generated from
`mcp-server/src/contract.ts` and `mcp-server/tools.json` by `npm run gen`. They are committed, and
`tests/gen.test.ts` fails if they are stale — the contract has exactly one source of truth.

## Licence

MIT.
