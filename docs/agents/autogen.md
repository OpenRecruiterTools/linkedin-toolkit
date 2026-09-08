# AutoGen

Registered functions over the HTTP action API, or the MCP workbench.

## Prerequisites

```bash
npx linkedin-toolkit-mcp     # pair the extension once
lit serve --http             # 127.0.0.1:47830
export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.bridge.token' ~/.linkedin-toolkit/config.json)
```

Add `--fake` to `lit serve` to run without a LinkedIn account: real envelopes, real error codes,
synthetic data.

## Config

```bash
pip install autogen-agentchat autogen-ext[openai] httpx
```

```python
import json, os, httpx
from autogen_agentchat.agents import AssistantAgent
from autogen_ext.models.openai import OpenAIChatCompletionClient

client = httpx.Client(
    base_url="http://127.0.0.1:47830",
    headers={"authorization": f"Bearer {os.environ['LINKEDIN_TOOLKIT_TOKEN']}"},
)

def action(name, **params):
    env = client.post(f"/actions/{name}", json={k: v for k, v in params.items() if v is not None}).json()
    if not env.get("ok"):
        raise RuntimeError(f"{env['error']['code']}: {env['error']['message']}")
    return env["data"]

async def linkedin_search_people(keywords: str, title: str = "", count: int = 50) -> str:
    """Search LinkedIn for people. Capped at 100 per call; each result spends search quota."""
    return json.dumps(action("search.people", keywords=keywords, title=title or None,
                             count=min(count, 100)))

async def linkedin_get_status() -> str:
    """Quota, Copilot/Autopilot mode, business hours, queue depth. Call before anything else."""
    return json.dumps(action("status.get"))

sourcer = AssistantAgent(
    name="linkedin_sourcer",
    model_client=OpenAIChatCompletionClient(model="gpt-4.1"),
    tools=[linkedin_get_status, linkedin_search_people],
    system_message=("You source people on LinkedIn. Check status first. Never invent a fact. "
                    "RATE_LIMITED, QUOTA_EXCEEDED and CHALLENGE_DETECTED are terminal — report "
                    "and stop, never retry. Writes queue for human approval."),
)
```

## MCP instead

`autogen-ext[mcp]` gives you every tool without writing wrappers:

```python
from autogen_ext.tools.mcp import StdioServerParams, McpWorkbench

params = StdioServerParams(command="npx", args=["-y", "linkedin-toolkit-mcp"])
async with McpWorkbench(params) as workbench:
    agent = AssistantAgent("sourcer", model_client=model_client, workbench=workbench)
```

## Human in the loop

AutoGen's `UserProxyAgent` and the toolkit's approval queue solve different halves of the same
problem: the proxy gates whether the agent *calls* the tool, the queue gates whether the message
*sends*. Use both. The queue is the one that cannot be bypassed by a prompt.

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
