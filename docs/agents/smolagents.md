# smolagents

`@tool` over the HTTP action API, or the MCP collection.

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
pip install smolagents httpx
```

```python
import json, os, httpx
from smolagents import CodeAgent, InferenceClientModel, tool

client = httpx.Client(
    base_url="http://127.0.0.1:47830",
    headers={"authorization": f"Bearer {os.environ['LINKEDIN_TOOLKIT_TOKEN']}"},
)

def action(name, **params):
    env = client.post(f"/actions/{name}", json={k: v for k, v in params.items() if v is not None}).json()
    if not env.get("ok"):
        raise RuntimeError(f"{env['error']['code']}: {env['error']['message']}")
    return env["data"]

@tool
def linkedin_search_people(keywords: str, title: str = None, count: int = 50) -> str:
    """Search LinkedIn for people and return normalised profiles as JSON.

    Args:
        keywords: Free-text search terms.
        title: Optional job title filter.
        count: Maximum 100 per call. Each result spends search quota from the daily cap of 1,000.
    """
    return json.dumps(action("search.people", keywords=keywords, title=title, count=min(count, 100)))

@tool
def linkedin_get_status() -> str:
    """Quota, Copilot/Autopilot mode, business hours and queue depth. Call before anything else."""
    return json.dumps(action("status.get"))

agent = CodeAgent(
    tools=[linkedin_get_status, linkedin_search_people],
    model=InferenceClientModel(),
)
agent.run("Find 20 CTOs at London fintechs and tell me how much search quota it cost")
```

smolagents parses the `Args:` block for the schema, so every argument needs a line there.

## A note on CodeAgent

`CodeAgent` writes Python that calls your tools, which is a genuinely good fit here — scoring,
deduplication and CSV shaping are code, not tool calls, and the model does them in one step
instead of ten.

Keep write tools out of a `CodeAgent`'s tool set unless you have watched it for a while. Generated
code in a loop calling `linkedin_send_invite` is the one shape where Copilot mode earns its keep,
and you would rather not need it to.

## MCP instead

```python
from smolagents import MCPClient, CodeAgent

with MCPClient({"command": "npx", "args": ["-y", "linkedin-toolkit-mcp"]}) as tools:
    agent = CodeAgent(tools=tools, model=InferenceClientModel())
```

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
