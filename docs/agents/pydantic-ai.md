# Pydantic AI

`@agent.tool` over the HTTP action API, or the built-in MCP client.

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
pip install pydantic-ai httpx
```

```python
import os
import httpx
from dataclasses import dataclass
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext, ModelRetry

@dataclass
class Toolkit:
    client: httpx.AsyncClient

    async def action(self, name: str, **params):
        params = {k: v for k, v in params.items() if v is not None}
        env = (await self.client.post(f"/actions/{name}", json=params)).json()
        if not env.get("ok"):
            code = env["error"]["code"]
            if code in {"RATE_LIMITED", "QUOTA_EXCEEDED", "CHALLENGE_DETECTED"}:
                # Terminal. Raising a plain error stops the run instead of triggering a retry.
                raise RuntimeError(f"{code}: {env['error']['message']}")
            raise ModelRetry(f"{code}: {env['error']['message']}")
        return env["data"]

class Person(BaseModel):
    public_id: str
    full_name: str
    headline: str | None = None
    company: str | None = None
    score: int = Field(ge=0, le=100)
    reason: str = Field(description="One line, grounded in a field the tool returned")

agent = Agent(
    "openai:gpt-4.1",
    deps_type=Toolkit,
    output_type=list[Person],
    system_prompt=("You source people on LinkedIn. Check status first. Never state a fact that "
                   "did not come from a tool result."),
)

@agent.tool
async def linkedin_get_status(ctx: RunContext[Toolkit]) -> dict:
    """Quota, Copilot/Autopilot mode, business hours, queue depth."""
    return await ctx.deps.action("status.get")

@agent.tool
async def linkedin_search_people(ctx: RunContext[Toolkit], keywords: str,
                                 title: str | None = None, count: int = 50) -> dict:
    """Search LinkedIn for people. Capped at 100 per call; each result spends search quota."""
    return await ctx.deps.action("search.people", keywords=keywords, title=title,
                                 count=min(count, 100))
```

`output_type` is the reason to use Pydantic AI here: a validated `list[Person]` means the model
cannot hand back a shortlist with a missing `public_id` or a `score` of 150, and the `reason`
field's description does real work in keeping the output grounded.

Note the `ModelRetry` split. Transient problems are worth a retry; `RATE_LIMITED`,
`QUOTA_EXCEEDED` and `CHALLENGE_DETECTED` are not, and retrying after a challenge is the specific
behaviour that turns a warning into a restriction.

## MCP instead

```python
from pydantic_ai.mcp import MCPServerStdio

server = MCPServerStdio("npx", args=["-y", "linkedin-toolkit-mcp"])
agent = Agent("openai:gpt-4.1", toolsets=[server])
```

## Next

- [Add the skills](../../skills/README.md) so the agent has recipes, not just tools
- [Tool reference](../tools.md) · [action contract](../actions.md)
- [Safety](../safety.md) — read this before you turn Autopilot on
