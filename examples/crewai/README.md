# CrewAI

Two agents, run sequentially. A **sourcer** builds the shortlist; a **writer** turns it into
outreach and puts it in the approval queue.

## Run

```bash
npx linkedin-toolkit-mcp        # pair the extension once
lit serve --http --fake         # drop --fake for a real session

python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY=sk-...
export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.bridge.token' ~/.linkedin-toolkit/config.json)
python research_crew.py "Heads of data engineering at Series B fintechs in London"
```

## Why two agents

Because sourcing and writing fail differently. The sourcer's failure mode is returning plausible
people; the writer's is returning plausible sentences. Splitting them means each one has a narrow
tool set and a `backstory` that pushes against its own specific failure, and the sourcer's output
becomes an artefact the writer has to work from rather than a context it can drift away from.

Tool split:

| Agent | Tools |
|---|---|
| Sourcer | `linkedin_get_status`, `linkedin_search_people`, `linkedin_get_profile`, `linkedin_get_connection_status` |
| Writer | `linkedin_get_profile`, `linkedin_send_invite`, `linkedin_queue_list` |

The sourcer cannot write to LinkedIn at all — not because it would be catastrophic (Copilot mode
queues everything anyway) but because an agent without a tool never has to be told not to use it.

## What it shows

- **Errors returned as data, not raised.** CrewAI recovers from a bad tool *result* far better
  than from a traceback, so `action()` returns `{"error": "RATE_LIMITED", "terminal": true}` and
  the agent reports it.
- **Guardrails in the `backstory`.** They apply to every task the agent runs, not just the one you
  remembered to write them into.
- **`context=[source_task]`** makes the shortlist a real input to the writing task rather than
  something the writer half-remembers.
- **`max_length=300`** on the invite note in the pydantic args schema, so the model is corrected
  before the call rather than after.

## Adding more tools

Subclass `BaseTool`, give it an `args_schema`, and call `action("<name>", **params)` with any
action from [`../../docs/actions.md`](../../docs/actions.md). The two rules that matter: the
`description` is what the model reads, so put the quota cost and the Copilot behaviour in it; and
never wrap a write tool in a retry.
