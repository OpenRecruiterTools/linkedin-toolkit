# Vercel AI SDK

A Next.js App Router route handler with six LinkedIn Toolkit tools attached to a streamed chat.

## Run

```bash
npx linkedin-toolkit-mcp        # pair the extension once
lit serve --http --fake         # drop --fake for a real session

npx create-next-app@latest my-app
cd my-app && npm i ai @ai-sdk/openai zod
cp path/to/route.ts app/api/chat/route.ts

export OPENAI_API_KEY=sk-...
export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.bridge.token' ~/.linkedin-toolkit/config.json)
npm run dev
```

Point any `useChat()` UI at `/api/chat`.

## The deployment caveat, up front

The toolkit runs on the user's machine and listens on `127.0.0.1:47830`. A route handler running
on Vercel has no route to that address — and it should not. There is no hosted session, no cloud
cookie jar, and no server-side LinkedIn login anywhere in this project. That is the safety story,
not a limitation to work around.

So this pattern is for **locally run apps**: an internal tool, a desktop shell, an app the user
starts on their own laptop.

If you genuinely need a remote agent to reach it, the user tunnels their own machine
(`cloudflared tunnel --url http://127.0.0.1:47830`) and pastes the URL and bearer token into your
app. Understand what that means before you suggest it: an open tunnel to a service holding a live
LinkedIn session, protected by one bearer token. Short-lived, and never in a shared environment.
[`../../docs/agents/chatgpt-connector.md`](../../docs/agents/chatgpt-connector.md) covers it in
full.

## What it shows

- **`inputSchema`, not `parameters`.** AI SDK 5 renamed it; a v4-shaped tool silently never fires.
- **Descriptions that teach the model the mode.** `linkedin_send_invite` says outright that
  `queued` is the expected result. Without it, models treat Copilot mode as an error.
- **`stopWhen`** capped at 20 steps. A sourcing run legitimately takes ten to fifteen tool calls;
  anything past twenty is a loop, usually against a rate limit.
- **Errors thrown, not swallowed.** The AI SDK feeds a thrown tool error back to the model as a
  tool result, so the structured `code` and `howToFix` reach the model intact.

## Adding more tools

The `linkedinTools` object is exported. Every action in
[`../../docs/actions.md`](../../docs/actions.md) is `POST /actions/{action}` with the params as the
body — adding `post.engagers`, `inbox.threads`, or `research.pack` is one more `tool({...})` entry.
