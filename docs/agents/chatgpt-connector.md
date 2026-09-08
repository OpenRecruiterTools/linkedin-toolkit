# ChatGPT connector

MCP over Streamable HTTP. This one has a real caveat, so read the whole page.

## The caveat, first

The toolkit runs on **your machine** and listens on `127.0.0.1:47830`. ChatGPT runs on OpenAI's
servers. For a connector to reach it, you have to expose a local service — one holding a live
LinkedIn session — to the public internet.

That is a genuine risk, not a formality. Anyone with the URL and the bearer token can search,
read, and queue writes against your LinkedIn account. Do it only if you actually need a remote
agent, keep the tunnel short-lived, and never leave one running.

Every other client on this page connects over stdio on your own machine and has none of this
exposure. Prefer one of those if you have the choice.

## Setup

**1. Serve over HTTP**

```bash
npx linkedin-toolkit-mcp     # pair the extension once
lit serve --http             # Streamable HTTP MCP at http://127.0.0.1:47830/mcp
```

**2. Tunnel it**

```bash
cloudflared tunnel --url http://127.0.0.1:47830
# → https://random-words-1234.trycloudflare.com
```

`ngrok http 47830` works too. Both give you an HTTPS URL that anyone can reach — the bearer token
is the only thing between it and your account.

**3. Add the connector**

ChatGPT → Settings → Connectors → *Add custom connector*:

| Field | Value |
|---|---|
| MCP server URL | `https://your-tunnel.trycloudflare.com/mcp` |
| Authentication | Bearer token |
| Token | `bridge.token` from `~/.linkedin-toolkit/config.json` |

Deep research and agent mode can use custom connectors; availability varies by plan and changes
often.

**4. Tear the tunnel down** when you are finished. Ctrl-C is the whole procedure.

## Hardening, if you must run one

- Rotate the bridge token after any session where the URL was shared: `lit token rotate`, then re-pair the popup with the new token.
- Keep Copilot mode on. Even with the token, a remote agent can only queue — a human still approves in the popup.
- Watch `lit queue list` while it runs.
- Never do this on a shared or public network.

## The safer alternative

Custom GPT Actions read `GET /openapi.json` from the same server, which gives you the whole action
surface as an OpenAPI 3.1 document. It has exactly the same tunnel exposure — it is not safer,
just a different import path. The genuinely safer option is a local client:
[Claude Desktop](claude-desktop.md), [Claude Code](claude-code.md), or
[Cursor](cursor.md).

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
