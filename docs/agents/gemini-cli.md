# Gemini CLI

MCP over stdio.

## Prerequisites

```bash
npx linkedin-toolkit-mcp
```

First run prints a pairing token. Open the extension popup → Settings → paste it → Connect. The
status dot goes green when the bridge is up. That is a one-time step; after it, the command above
is all any client needs.

## Config

`~/.gemini/settings.json` for every project, or `.gemini/settings.json` for one:

```json
{
  "mcpServers": {
    "linkedin-toolkit": {
      "command": "npx",
      "args": ["-y", "linkedin-toolkit-mcp"],
      "timeout": 600000,
      "trust": false
    }
  }
}
```

`timeout` is worth raising: `linkedin_research_pack` waits for a job that can legitimately run for
minutes. `trust: false` keeps the per-call confirmation prompt, which is what you want alongside
Copilot mode.

Then:

```bash
gemini
/mcp        # lists servers and their tools
```

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
