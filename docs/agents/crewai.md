# CrewAI

`BaseTool` subclasses over the HTTP action API.

## Prerequisites

```bash
npx linkedin-toolkit-mcp     # pair the extension once
lit serve --http             # 127.0.0.1:47830
export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.token' ~/.linkedin-toolkit/config.json)
```

Add `--fake` to `lit serve` to run without a LinkedIn account: real envelopes, real error codes,
synthetic data.

## Config

```bash
pip install crewai httpx
```

```python
import json, os, httpx
from typing import Type
from crewai import Agent, Crew, Task
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

client = httpx.Client(
    base_url="http://127.0.0.1:47830",
    headers={"authorization": f"Bearer {os.environ['LINKEDIN_TOOLKIT_TOKEN']}"},
)

def action(name, **params):
    env = client.post(f"/actions/{name}", json={k: v for k, v in params.items() if v is not None}).json()
    if not env.get("ok"):
        # Return the error as data. CrewAI recovers from a bad tool result far better than
        # from a traceback.
        return {"error": env["error"]["code"], "message": env["error"]["message"]}
    return env["data"]

class SearchArgs(BaseModel):
    keywords: str = Field(description="Free-text search terms")
    title: str | None = None
    count: int = Field(default=50, le=100)

class SearchTool(BaseTool):
    name: str = "linkedin_search_people"
    description: str = ("Search LinkedIn for people. Capped at 100 per call. Each result spends "
                        "search quota from the daily cap of 1,000.")
    args_schema: Type[BaseModel] = SearchArgs

    def _run(self, keywords: str, title=None, count=50) -> str:
        return json.dumps(action("search.people", keywords=keywords, title=title, count=min(count, 100)))

sourcer = Agent(
    role="LinkedIn Sourcer",
    goal="Build a deduplicated, scored shortlist that matches the brief and nothing else.",
    backstory="Never invents a fact. Checks quota before spending it. Reports terminal errors "
              "rather than retrying.",
    tools=[SearchTool()],
)
```

## Working example

[`examples/crewai/`](../../examples/crewai/) — a sourcer and a writer with split tool sets, so the
sourcer has no write capability at all.

## Two things that matter

**Split the crew by failure mode.** Sourcing fails by returning plausible people; writing fails by
returning plausible sentences. Separate agents with narrow tool sets and specific backstories fail
less than one agent with everything.

**Guardrails in the `backstory`, not just the task.** They then apply to every task the agent runs,
including the ones you write next month.

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
