# Client configuration

Every MCP client runs the same command — `npx -y linkedin-toolkit-mcp` — and differs only in
which file it reads and how that file spells "servers". This page has both, per client, for
copying and pasting.

You do not have to. For the five clients with a config file on this machine, `lit setup` merges
the block in for you, keeping your other servers and backing the file up first:

```bash
npx linkedin-toolkit-mcp setup --client claude-code
#   --client claude-desktop | claude-code | cursor | windsurf | vscode | n8n | print
#   --dry-run    print what it would write, and write nothing
```

If you have not installed the extension yet, start there —
[the quick start](../README.md#quick-start) is the same command.

---

## Claude Code

`.mcp.json` in your project root — what `lit setup --client claude-code` writes.

```json
{
  "mcpServers": {
    "linkedin-toolkit": {
      "command": "npx",
      "args": ["-y", "linkedin-toolkit-mcp"]
    }
  }
}
```

Claude Code asks you to approve a project's MCP servers the first time you open it. For every
project instead of one, `claude mcp add --scope user linkedin-toolkit -- npx -y linkedin-toolkit-mcp`.
More: [docs/agents/claude-code.md](agents/claude-code.md).

## Claude Desktop

| OS | File |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "linkedin-toolkit": {
      "command": "npx",
      "args": ["-y", "linkedin-toolkit-mcp"]
    }
  }
}
```

Settings → Developer → Edit Config opens the same file. **Quit and reopen the app** afterwards —
reloading the window is not enough. More: [docs/agents/claude-desktop.md](agents/claude-desktop.md).

## Cursor

`~/.cursor/mcp.json` for every project — what `lit setup --client cursor` writes — or
`.cursor/mcp.json` inside one project, with identical contents.

```json
{
  "mcpServers": {
    "linkedin-toolkit": {
      "command": "npx",
      "args": ["-y", "linkedin-toolkit-mcp"]
    }
  }
}
```

Settings → MCP lists the server and its tool count. More: [docs/agents/cursor.md](agents/cursor.md).

## Windsurf

`~/.codeium/windsurf/mcp_config.json`.

```json
{
  "mcpServers": {
    "linkedin-toolkit": {
      "command": "npx",
      "args": ["-y", "linkedin-toolkit-mcp"]
    }
  }
}
```

Settings → Cascade → MCP Servers → *Refresh* reloads it without restarting.
More: [docs/agents/windsurf.md](agents/windsurf.md).

## VS Code

`.vscode/mcp.json` in your workspace — what `lit setup --client vscode` writes. VS Code's key is
`servers`, not `mcpServers`, and it wants the transport named.

```json
{
  "servers": {
    "linkedin-toolkit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "linkedin-toolkit-mcp"]
    }
  }
}
```

A **Start** button appears above the entry; the tools then show up in agent mode's tool picker.
For every workspace, run *MCP: Open User Configuration* from the command palette and put the same
block in the file it opens.

## n8n

Printed, never written: n8n has no MCP config file on your machine. The **MCP Client Tool** node
is configured inside a workflow, and a Docker install cannot see this filesystem at all.

- **Same machine, npm install:** in the MCP Client Tool node, choose the command transport,
  command `npx`, arguments `-y linkedin-toolkit-mcp`.
- **n8n in Docker, or n8n Cloud:** use the HTTP surface instead. Run `lit serve --http` on the
  machine with Chrome, and point n8n's HTTP Request nodes at
  `POST http://<that machine>:47830/actions/{action}` with the pairing token as a bearer token.

There is also a community node and an importable example workflow:
[docs/agents/n8n.md](agents/n8n.md) · [examples/n8n](../examples/n8n/).

## Cline

`cline_mcp_settings.json`, reachable from the MCP Servers icon in the Cline panel → *Configure
MCP Servers*. Same `mcpServers` block as Claude Code.
More: [docs/agents/cline.md](agents/cline.md).

## OpenClaw

Same `mcpServers` block, plus the six skills in [`skills/`](../skills/) drop into
`~/.openclaw/skills/` unchanged. More: [docs/agents/openclaw.md](agents/openclaw.md).

## Zed

`settings.json` → `context_servers`, a different shape:

```json
{
  "context_servers": {
    "linkedin-toolkit": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "linkedin-toolkit-mcp"],
      "env": {}
    }
  }
}
```

More: [docs/agents/zed.md](agents/zed.md).

## Codex CLI

`~/.codex/config.toml`, TOML rather than JSON:

```toml
[mcp_servers.linkedin-toolkit]
command = "npx"
args = ["-y", "linkedin-toolkit-mcp"]
```

More: [docs/agents/codex.md](agents/codex.md).

## Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "linkedin-toolkit": {
      "command": "npx",
      "args": ["-y", "linkedin-toolkit-mcp"]
    }
  }
}
```

More: [docs/agents/gemini-cli.md](agents/gemini-cli.md).

## Remote and hosted agents

Anything that cannot launch a local process — the Claude API MCP connector, ChatGPT connectors,
Cloudflare Agents — speaks to `lit serve --http` over Streamable HTTP with the pairing token as a
bearer token. That means exposing a port from the machine your Chrome is on; read
[docs/agents/chatgpt-connector.md](agents/chatgpt-connector.md) before you do.

## SDKs, not MCP

`npm i linkedin-toolkit`, `pip install linkedin-toolkit`, or plain HTTP against
`POST /actions/{action}` with `GET /openapi.json` alongside it.
[One page per framework](agents/README.md) · [examples in seven languages](../examples/).

---

## When it does not work

**`npx` is not found.** The client is not inheriting your shell's PATH. Use an absolute path:
`which npx` (macOS, Linux) or `where npx.cmd` (Windows) and put that in `command`. On Windows some
clients need `"command": "cmd"` with `"args": ["/c", "npx", "-y", "linkedin-toolkit-mcp"]`.

**The tools appear but every call answers `EXTENSION_OFFLINE`.** Chrome is closed, or the
extension has not been paired. Open the popup → Settings → Local bridge, paste the token from
`lit config get token --reveal`, and enable it. `lit status` confirms.

**`lit setup` refused to write my config.** That file is not valid JSON, and overwriting it would
lose whatever else is in it. Fix or move the file and run setup again; it never rewrites what it
cannot parse, and it backs up what it can.

**Two servers with the same name.** `lit setup` replaces an existing `linkedin-toolkit` entry and
leaves every other server alone. The old file is saved as `<file>.bak-<timestamp>` next to it.
