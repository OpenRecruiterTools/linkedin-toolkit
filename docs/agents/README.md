# Agents

One page per ecosystem, each with the exact config block for that client. Everything below talks
to the same bridge and the same engine, so the caps, the pacing and the approval queue apply
identically no matter how you connect.

**Start here if you are an agent:** [quickstart.md](quickstart.md).

## MCP over stdio — `npx linkedin-toolkit-mcp`

| Client | Config file |
|---|---|
| [Claude Code](claude-code.md) | `.mcp.json` |
| [Claude Desktop](claude-desktop.md) | `claude_desktop_config.json` |
| [Cursor](cursor.md) | `.cursor/mcp.json` |
| [Windsurf](windsurf.md) | `~/.codeium/windsurf/mcp_config.json` |
| [Zed](zed.md) | `settings.json` → `context_servers` |
| [Cline](cline.md) | `cline_mcp_settings.json` |
| [OpenClaw](openclaw.md) | MCP config + native skills |
| [Codex CLI](codex.md) | `~/.codex/config.toml` |
| [Gemini CLI](gemini-cli.md) | `~/.gemini/settings.json` |

## MCP over Streamable HTTP — `lit serve --http`

| Client | Notes |
|---|---|
| [ChatGPT connector](chatgpt-connector.md) | Needs a tunnel. Read the risks before you do it. |

## SDKs — HTTP action API

| Framework | |
|---|---|
| [OpenAI Agents SDK](openai-agents.md) | TypeScript · [example](../../examples/openai-agents/) |
| [Vercel AI SDK](vercel-ai.md) | TypeScript · [example](../../examples/vercel-ai/) |
| [LangChain](langchain.md) | Python and JS · [example](../../examples/langchain/) |
| [LlamaIndex](llamaindex.md) | Python |
| [CrewAI](crewai.md) | Python · [example](../../examples/crewai/) |
| [AutoGen](autogen.md) | Python |
| [Google ADK](google-adk.md) | Python |
| [Pydantic AI](pydantic-ai.md) | Python |
| [smolagents](smolagents.md) | Python |

## Automation platforms

| Platform | |
|---|---|
| [n8n](n8n.md) | HTTP nodes, community node, or MCP client · [example workflow](../../examples/n8n/) |
| [Dify](dify.md) | OpenAPI import or MCP plugin |

Anything else that speaks HTTP: `lit serve --http` also exposes `GET /openapi.json`, an OpenAPI
3.1 document generated from the action contract.
