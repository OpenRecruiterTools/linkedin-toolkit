# Dify

OpenAPI import, or the MCP plugin.

## Prerequisites

```bash
npx linkedin-toolkit-mcp     # pair the extension once
lit serve --http             # 127.0.0.1:47830
```

## Option 1 — import the OpenAPI schema

The server generates an OpenAPI 3.1 document from the action contract:

```bash
curl -s http://127.0.0.1:47830/openapi.json > linkedin-toolkit.json
```

Dify → Tools → *Create Custom Tool*:

| Field | Value |
|---|---|
| Schema | paste `linkedin-toolkit.json` |
| Authorization | API Key, header `Authorization`, value `Bearer <token>` |
| Server URL | `http://127.0.0.1:47830` |

Every action becomes a tool your agent or workflow can call. Because the document is generated from
the contract, it never drifts from the tools the MCP server exposes.

## Option 2 — MCP plugin

Dify's MCP plugin connects over Streamable HTTP: `http://127.0.0.1:47830/mcp`, bearer auth.

## Self-hosted Dify

Dify in Docker cannot reach `127.0.0.1` on your host. Use `http://host.docker.internal:47830`, or
put both on the same Docker network. Dify Cloud cannot reach your machine at all without a
tunnel — read [chatgpt-connector.md](chatgpt-connector.md) for what that exposes before you do it.

## Workflow shape

The pattern that works: **LLM node** turns the brief into search parameters → **Tool node**
(`search.people`) → **Code node** deduplicates and scores → **LLM node** drafts openers →
**Tool node** (`outreach.invite`) which queues them → **Answer node** tells the user their drafts
are in the extension popup awaiting approval.

Keep the last step honest. In Copilot mode `outreach.invite` returns
`{ "status": "queued", "queueId": … }` and nothing has been sent.

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
