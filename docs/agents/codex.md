# Codex CLI

MCP over stdio, configured in TOML.

## Prerequisites

```bash
npx linkedin-toolkit-mcp
```

First run prints a pairing token. Open the extension popup → Settings → paste it → Connect. The
status dot goes green when the bridge is up. That is a one-time step; after it, the command above
is all any client needs.

## Config

`~/.codex/config.toml`:

```toml
[mcp_servers.linkedin-toolkit]
command = "npx"
args = ["-y", "linkedin-toolkit-mcp"]
```

TOML, not JSON — the section header is `[mcp_servers.<name>]` with an underscore.

Environment variables, if you need them:

```toml
[mcp_servers.linkedin-toolkit]
command = "npx"
args = ["-y", "linkedin-toolkit-mcp"]
env = { LINKEDIN_TOOLKIT_PORT = "47829" }
```

Then:

```bash
codex
```

and ask. `codex mcp list` shows configured servers.

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
