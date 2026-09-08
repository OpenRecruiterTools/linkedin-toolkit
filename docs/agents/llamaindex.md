# LlamaIndex

`FunctionTool` over the HTTP action API, or the MCP adapter.

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
pip install llama-index httpx
```

```python
import json, os, httpx
from llama_index.core.tools import FunctionTool
from llama_index.core.agent.workflow import FunctionAgent
from llama_index.llms.openai import OpenAI

client = httpx.Client(
    base_url="http://127.0.0.1:47830",
    headers={"authorization": f"Bearer {os.environ['LINKEDIN_TOOLKIT_TOKEN']}"},
)

def action(name, **params):
    env = client.post(f"/actions/{name}", json={k: v for k, v in params.items() if v is not None}).json()
    if not env.get("ok"):
        raise RuntimeError(f"{env['error']['code']}: {env['error']['message']}")
    return env["data"]

def search_people(keywords: str, title: str = None, location: str = None, count: int = 50) -> str:
    """Search LinkedIn for people. Capped at 100 per call; each result spends search quota
    from the daily cap of 1,000."""
    return json.dumps(action("search.people", keywords=keywords, title=title,
                             location=location, count=min(count, 100)))

def get_profile(public_id: str, full: bool = False) -> str:
    """One profile by publicId. full=True adds page text and photo and spends one profile
    visit from the daily cap of 500."""
    return json.dumps(action("profile.get", publicId=public_id, full=full))

agent = FunctionAgent(
    tools=[FunctionTool.from_defaults(fn=search_people), FunctionTool.from_defaults(fn=get_profile)],
    llm=OpenAI(model="gpt-4.1"),
    system_prompt="Never state a fact about a person that did not come from a tool result.",
)
```

The docstring becomes the tool description, so put the quota cost in it.

## Indexing what you capture

The natural LlamaIndex use: pull profiles into a vector index and query them in natural language.

```python
from llama_index.core import Document, VectorStoreIndex

profiles = action("search.people", keywords="CTO fintech London", count=100)["profiles"]
docs = [
    Document(
        text=f"{p['fullName']} — {p.get('headline','')}\n{p.get('company','')} · {p.get('location','')}",
        metadata={"publicId": p["publicId"], "company": p.get("company"), "url": p["url"]},
    )
    for p in profiles
]
index = VectorStoreIndex.from_documents(docs)
print(index.as_query_engine().query("who has payments infrastructure experience?"))
```

For anything you have already captured, `linkedin_query_sql` reads the local SQLite mirror
directly — no quota, no network.

## MCP instead

`llama-index-tools-mcp` connects to the stdio server and exposes all 39 tools without wrappers.

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
