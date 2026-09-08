# Google Agent Development Kit

`FunctionTool` over the HTTP action API, or the built-in MCP toolset.

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
pip install google-adk httpx
```

```python
import json, os, httpx
from google.adk.agents import Agent

client = httpx.Client(
    base_url="http://127.0.0.1:47830",
    headers={"authorization": f"Bearer {os.environ['LINKEDIN_TOOLKIT_TOKEN']}"},
)

def _action(name, **params):
    env = client.post(f"/actions/{name}", json={k: v for k, v in params.items() if v is not None}).json()
    if not env.get("ok"):
        return {"status": "error", "error_code": env["error"]["code"],
                "error_message": env["error"]["message"]}
    return {"status": "success", "data": env["data"]}

def linkedin_get_status() -> dict:
    """Connection, login, Copilot/Autopilot mode, business hours, remaining quota per action
    type, and queue depth. Call this before anything else.

    Returns:
        dict: status "success" with the data, or "error" with error_code and error_message.
    """
    return _action("status.get")

def linkedin_search_people(keywords: str, title: str = "", location: str = "", count: int = 50) -> dict:
    """Search LinkedIn for people and return normalised profiles.

    Args:
        keywords (str): Free-text search terms.
        title (str): Optional job title filter.
        location (str): Optional location filter.
        count (int): Maximum 100 per call. Each result spends search quota.

    Returns:
        dict: status "success" with profiles, or "error" with error_code and error_message.
    """
    return _action("search.people", keywords=keywords, title=title or None,
                   location=location or None, count=min(count, 100))

root_agent = Agent(
    name="linkedin_sourcer",
    model="gemini-2.0-flash",
    instruction=("You source people on LinkedIn. Check status first and plan inside the quota. "
                 "Never state a fact that did not come from a tool result. RATE_LIMITED, "
                 "QUOTA_EXCEEDED and CHALLENGE_DETECTED are terminal — report and stop."),
    tools=[linkedin_get_status, linkedin_search_people],
)
```

ADK reads the docstring and the type hints to build the schema, so the Args and Returns sections
are load-bearing. Returning a dict with a `status` key is the ADK convention and it makes error
handling legible to the model.

## MCP instead

```python
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StdioServerParameters

toolset = MCPToolset(
    connection_params=StdioServerParameters(command="npx", args=["-y", "linkedin-toolkit-mcp"])
)
root_agent = Agent(name="linkedin_sourcer", model="gemini-2.0-flash", tools=[toolset])
```

All 39 tools, no wrappers.

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
