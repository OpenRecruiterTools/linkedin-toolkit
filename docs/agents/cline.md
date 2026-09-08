# Cline

MCP over stdio, inside VS Code.

## Prerequisites

```bash
npx linkedin-toolkit-mcp
```

First run prints a pairing token. Open the extension popup → Settings → paste it → Connect. The
status dot goes green when the bridge is up. That is a one-time step; after it, the command above
is all any client needs.

## Config

Cline → MCP Servers → *Configure MCP Servers* opens `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "linkedin-toolkit": {
      "command": "npx",
      "args": ["-y", "linkedin-toolkit-mcp"],
      "disabled": false,
      "autoApprove": ["linkedin_get_status", "linkedin_search_people", "linkedin_get_profile"]
    }
  }
}
```

`autoApprove` skips the confirmation prompt for the tools you list. Put **read tools only** in
there. Auto-approving `linkedin_send_invite` removes one of the two safety layers — Copilot mode
would still queue the invite, but you would no longer see it being drafted.

The server shows up under the MCP Servers panel with its tool count and a live status dot.

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
