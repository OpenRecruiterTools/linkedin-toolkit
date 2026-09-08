# Skills

Six task recipes in the [Agent Skills](https://agentskills.io) format. Each is a folder with a
`SKILL.md`: YAML frontmatter (`name`, `description` with trigger phrases) plus a body that tells
the agent when to use it, what it needs, exactly which LinkedIn Toolkit tools to call in what
order, how to format the answer, and what it must never do.

They are plain markdown. No runtime, no dependencies, no lock-in — any agent runtime that reads
the Agent Skills format loads them unchanged.

| Skill | Does | Triggers on |
|---|---|---|
| [`linkedin-sourcer`](linkedin-sourcer/SKILL.md) | Brief → searches → dedupe → score → named list + CSV | "source candidates", "build a shortlist", "find CTOs at" |
| [`linkedin-outreach-writer`](linkedin-outreach-writer/SKILL.md) | Profile facts → connection note / DM / InMail, two variants, queued for approval | "write an opener", "draft a connection note", "what should I say" |
| [`linkedin-campaign-runner`](linkedin-campaign-runner/SKILL.md) | Template + list → campaign, enroll, monitor, report per-step accept and reply rates | "run a campaign", "enroll this list", "how is my campaign doing" |
| [`linkedin-profile-to-dossier`](linkedin-profile-to-dossier/SKILL.md) | One profile + company + your web search → one-page briefing | "brief me on", "prep me for this meeting", "who is this person" |
| [`linkedin-reply-triage`](linkedin-reply-triage/SKILL.md) | Inbox → intent buckets, drafted replies, meetings to book | "triage my inbox", "any good replies", "who wants a meeting" |
| [`linkedin-research-pack`](linkedin-research-pack/SKILL.md) | CSV → resolve, capture, signals, web research, dossier per row + enriched CSV | "research this list", "enrich this CSV", "prep these accounts" |

All six require the MCP server to be running and the extension paired. See the
[quickstart](../docs/agents/quickstart.md).

## Install

### Claude Code

Per project — the skills travel with the repo:

```bash
mkdir -p .claude/skills
cp -r skills/* .claude/skills/
```

Or globally, available in every session:

```bash
cp -r skills/* ~/.claude/skills/
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force .claude\skills
Copy-Item -Recurse skills\* .claude\skills\
```

Restart Claude Code (or run `/skills`) and the six appear.

### OpenClaw

Copy the folders into OpenClaw's skills directory:

```bash
cp -r skills/* ~/.openclaw/skills/
```

Project-scoped skills in `./.openclaw/skills/` work the same way.

### Any other runtime

The format is a folder containing `SKILL.md`. If your runtime reads Agent Skills, point it at
`skills/`. If it does not, the `SKILL.md` bodies are readable prompts — paste one into a system
prompt or a custom instruction block and it works, because every tool call in them uses the
exact MCP tool names the server exposes.

## Writing your own

Copy the shape:

```markdown
---
name: my-skill
description: One sentence on what it does, then the phrases a user would actually type.
---

# My Skill
## When to use
## Inputs
## Steps          <- exact tool names and argument shapes, numbered
## Output format
## Guardrails     <- facts only, caps, Copilot mode, what it must never do
```

Two rules that make the difference between a skill that fires and one that sits there:

1. **The description carries the triggers.** Write the phrases a real user types, not a category
   label. That string is what the runtime matches on.
2. **The steps carry real tool names and real argument shapes.** `linkedin_search_people` with
   `{ keywords, title, location, source, start, count }` — not "search LinkedIn". Names come from
   [`docs/tools.md`](../docs/tools.md); the contract is [`docs/actions.md`](../docs/actions.md).

Every skill must state the three non-negotiables in its guardrails: facts only from tool results,
hard caps that no client can raise, and Copilot mode — writes queue for human approval until the
user turns Autopilot on themselves.

Contributions welcome. See [CONTRIBUTING.md](../CONTRIBUTING.md).
