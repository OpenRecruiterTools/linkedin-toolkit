# Claude Code

The shortest path from nothing to an agent that can source people on LinkedIn.

## Setup

Copy [`.mcp.json`](.mcp.json) to the root of your project:

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

Then:

```bash
claude
/mcp          # linkedin-toolkit should be listed as connected
```

The first run of the server prints a pairing token. Open the extension popup → Settings → paste it
→ Connect. The popup's status dot goes green when the bridge is up.

Add the skills so Claude knows the recipes, not just the tools:

```bash
mkdir -p .claude/skills && cp -r ../../skills/* .claude/skills/
```

## Then just ask

```
> Find me 20 heads of data engineering at Series B fintechs in London,
  check who I'm already connected to, and draft invites for the top 8.
```

[`transcript.md`](transcript.md) is what that run looks like, tool call by tool call, ending where
every agent-initiated write ends: in the approval queue, waiting for a human.

## Also available

**Resources** — `@linkedin://status`, `@linkedin://queue`, `@linkedin://list/{listId}`,
`@linkedin://profile/{publicId}`. Type `@` in Claude Code to browse them.

**Prompts** — `/source-candidates`, `/write-opener`, `/triage-inbox`. These are server-provided
slash commands, so they arrive with the tools and need no setup.

## Read-only mode

If you want an agent that can search and read but never write, allow only the read tools:

```json
{
  "mcpServers": {
    "linkedin-toolkit": {
      "command": "npx",
      "args": ["-y", "linkedin-toolkit-mcp"]
    }
  },
  "permissions": {
    "allow": [
      "mcp__linkedin-toolkit__linkedin_get_status",
      "mcp__linkedin-toolkit__linkedin_search_people",
      "mcp__linkedin-toolkit__linkedin_get_profile",
      "mcp__linkedin-toolkit__linkedin_get_connection_status",
      "mcp__linkedin-toolkit__linkedin_list_all",
      "mcp__linkedin-toolkit__linkedin_list_members",
      "mcp__linkedin-toolkit__linkedin_query_sql"
    ],
    "deny": [
      "mcp__linkedin-toolkit__linkedin_send_invite",
      "mcp__linkedin-toolkit__linkedin_send_message",
      "mcp__linkedin-toolkit__linkedin_send_inmail",
      "mcp__linkedin-toolkit__linkedin_comment_post"
    ]
  }
}
```

Belt and braces: Copilot mode already queues every agent write for human approval. This just stops
the agent from filling the queue in the first place.
