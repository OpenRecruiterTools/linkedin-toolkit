# Claude Code

MCP over stdio. Project-scoped config, so the toolkit travels with the repo.

## Prerequisites

```bash
npx linkedin-toolkit-mcp
```

First run prints a pairing token. Open the extension popup → Settings → paste it → Connect.

## Config

`.mcp.json` in your project root:

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

Or add it from the command line:

```bash
claude mcp add linkedin-toolkit -- npx -y linkedin-toolkit-mcp
```

For every project instead of one, use `claude mcp add --scope user`.

## Skills

```bash
mkdir -p .claude/skills && cp -r skills/* .claude/skills/
```

Six recipes — sourcing, outreach writing, campaign running, dossiers, reply triage, Research Pack.
They carry the guardrails as well as the tool sequence. [Details](../../skills/README.md).

## Verify

```bash
claude
/mcp        # linkedin-toolkit → connected
```

Then: `What's my LinkedIn Toolkit status?`

## Read-only agent

Copilot mode already queues every write. To go further and deny the write tools outright, see the
permissions block in [`examples/claude-code/README.md`](../../examples/claude-code/README.md).

## A full run

[`examples/claude-code/transcript.md`](../../examples/claude-code/transcript.md) — a sourcing run,
tool call by tool call, ending in the approval queue.

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
