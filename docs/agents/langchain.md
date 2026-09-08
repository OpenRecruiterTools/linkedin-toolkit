# LangChain

Python or JavaScript, over the HTTP action API.

## Prerequisites

```bash
npx linkedin-toolkit-mcp     # pair the extension once
lit serve --http             # 127.0.0.1:47830
export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.bridge.token' ~/.linkedin-toolkit/config.json)
```

Add `--fake` to `lit serve` to run without a LinkedIn account: real envelopes, real error codes,
synthetic data.

## Python

```bash
pip install httpx langchain-core langgraph langchain-openai
```

```python
import json, os, httpx
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

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
def linkedin_search_people(keywords: str, title: str | None = None, count: int = 50) -> str:
    """Search LinkedIn for people. Capped at 100 per call; each result spends search quota."""
    return json.dumps(action("search.people", keywords=keywords, title=title, count=min(count, 100)))

agent = create_react_agent(ChatOpenAI(model="gpt-4.1"), [linkedin_search_people])
```

## JavaScript

```bash
npm i @langchain/core @langchain/openai
```

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const searchPeople = tool(
  async ({ keywords, count }) => JSON.stringify(await action('search.people', { keywords, count })),
  {
    name: 'linkedin_search_people',
    description: 'Search LinkedIn for people. Capped at 100 per call.',
    schema: z.object({ keywords: z.string(), count: z.number().max(100).optional() }),
  },
);
```

## Working example

[`examples/langchain/`](../../examples/langchain/) — a LangGraph ReAct agent with eight tools, plus
notes on swapping in Claude or a local Ollama model so nothing leaves the machine.

## MCP instead

`langchain-mcp-adapters` connects to the stdio server directly and gives you every tool without
writing any of them:

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({
    "linkedin-toolkit": {"command": "npx", "args": ["-y", "linkedin-toolkit-mcp"], "transport": "stdio"}
})
tools = await client.get_tools()
```

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
