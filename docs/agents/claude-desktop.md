# Claude Desktop

MCP over stdio. One JSON file, then restart the app.

## Prerequisites

```bash
npx linkedin-toolkit-mcp
```

First run prints a pairing token. Open the extension popup → Settings → paste it → Connect. The
status dot goes green when the bridge is up. That is a one-time step; after it, the command above
is all any client needs.

## Config

Edit `claude_desktop_config.json`:

| OS | Path |
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

Settings → Developer → Edit Config opens the same file.

**Quit and reopen Claude Desktop** — a reload is not enough. The tools appear under the
tools icon in the composer.

If `npx` is not found, Claude Desktop is not inheriting your shell's PATH. Use an absolute path:
`"command": "/usr/local/bin/npx"` (`which npx` will tell you), or on Windows the full path to
`npx.cmd`.

## Verify

Ask for the status:

```
What's my LinkedIn Toolkit status?
```

You should get quota numbers, whether Autopilot is on, and the queue depth. If you get
`EXTENSION_OFFLINE`, Chrome is closed or the pairing token has not been entered.

## What you get

39 tools, 4 resources (`linkedin://status`, `linkedin://queue`, `linkedin://list/{listId}`,
`linkedin://profile/{publicId}`) and 3 prompts (`source-candidates`, `write-opener`,
`triage-inbox`). Full list in [`../tools.md`](../tools.md).

Every write queues for your approval in the extension popup until you turn Autopilot on yourself.
That is the default and you should leave it that way for a while.

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
