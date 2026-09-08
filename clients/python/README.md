# linkedin-toolkit (Python)

The Python client for [LinkedIn Toolkit](https://github.com/FormatixAI/linkedin-toolkit), with
ready-made tool wrappers for LangChain, LlamaIndex, CrewAI, AutoGen, Google ADK, Pydantic AI and
smolagents.

It talks to the local HTTP API that `lit serve --http` exposes on `127.0.0.1:47830`. Nothing leaves
your machine except the LinkedIn calls your own Chrome makes.

```bash
pip install linkedin-toolkit
```

## Prerequisites

```bash
npx linkedin-toolkit-mcp     # pair the extension once
lit serve --http             # 127.0.0.1:47830
```

Add `--fake` to `lit serve` to run without a LinkedIn account: real envelopes, real error codes,
invented data.

## Use it

```python
from linkedin_toolkit import LinkedInToolkit

client = LinkedInToolkit()                    # finds the URL and token for you

status = client.status_get()
data = client.search_people(keywords="CTO fintech London", count=25)
invite = client.outreach_invite(publicId=data["profiles"][0]["publicId"], note="Hello.")

invite["status"]   # 'queued' — a human approves it in the extension popup. That is success.
```

One keyword-only method per action, named by snake-casing it: `search.people` → `search_people`,
`network.unfollowCount` → `network_unfollow_count`. Parameter names are the contract's own —
`publicId`, not `public_id` — so one vocabulary covers MCP, HTTP, the docs and every wrapper.

Async is the same surface, awaited:

```python
from linkedin_toolkit import AsyncLinkedInToolkit

async with AsyncLinkedInToolkit() as client:
    data = await client.search_people(keywords="CTO fintech London")
```

`call(action, params)` is the untyped escape hatch; `call_tool(name, args)` reaches the three tools
that are not a bare action (`linkedin_query_sql`, `linkedin_sync`, `linkedin_research_pack`).

Requests time out after 120 s by default (`timeout=`). `linkedin_research_pack` is the exception:
the server waits for that job to finish, so the client gives it 11 minutes — wider than the
server's own 10-minute budget. `research_pack(...)`, the action rather than the tool, returns a job
id immediately and is unaffected.

## Configuration

Nothing is required. In order:

1. `LinkedInToolkit(base_url=..., token=...)`
2. `LINKEDIN_TOOLKIT_URL` / `LINKEDIN_TOOLKIT_TOKEN`
3. `~/.linkedin-toolkit/server.json` — the port a running `lit serve` actually bound
4. `~/.linkedin-toolkit/config.json` — the pairing token, and the configured port
5. `http://127.0.0.1:47830`

`LINKEDIN_TOOLKIT_HOME` moves the directory, as it does for the server. `client.config` says which
source each value came from.

## Errors

```python
from linkedin_toolkit import LinkedInToolkitError

try:
    client.outreach_invite(publicId="someone")
except LinkedInToolkitError as err:
    err.code          # 'RATE_LIMITED' | 'CHALLENGE_DETECTED' | …
    err.how_to_fix    # pass this to the user verbatim
    err.retry_after   # milliseconds, when the server said
    err.terminal      # True for RATE_LIMITED, QUOTA_EXCEEDED, CHALLENGE_DETECTED, NOT_LOGGED_IN
```

**This client never retries.** Half of these codes are terminal, and retrying after a challenge is
the specific behaviour that turns a LinkedIn warning into a restriction.

## Models

`linkedin_toolkit.models` has pydantic models for every shared type — `Profile`, `Company`,
`Thread`, `Message`, `List`, `Campaign`, `QueueItem`, `WriteResult`, `RateLimit`, `Status`, `Pack`
and the rest. They allow extra fields on purpose: the extension is authoritative about what a
profile contains and ships on its own cadence.

```python
from linkedin_toolkit import models

people = [models.Profile.model_validate(p) for p in data["profiles"]]
```

## Tools and framework wrappers

`client.tools()` returns the same 39 definitions the MCP server advertises — `{name, description,
parameters}` — read from a committed copy of `mcp-server/tools.json`, so it works with the server
stopped.

| Framework | Import | Extra |
|---|---|---|
| LangChain | `linkedin_toolkit.integrations.langchain` | `linkedin-toolkit[langchain]` |
| LlamaIndex | `linkedin_toolkit.integrations.llama_index` | `linkedin-toolkit[llamaindex]` |
| CrewAI | `linkedin_toolkit.integrations.crewai` | `linkedin-toolkit[crewai]` |
| AutoGen | `linkedin_toolkit.integrations.autogen` | `linkedin-toolkit[autogen]` |
| Google ADK | `linkedin_toolkit.integrations.google_adk` | `linkedin-toolkit[google-adk]` |
| Pydantic AI | `linkedin_toolkit.integrations.pydantic_ai` | `linkedin-toolkit[pydantic-ai]` |
| smolagents | `linkedin_toolkit.integrations.smolagents` | `linkedin-toolkit[smolagents]` |

Every one exposes the same `get_tools(client, include=…, exclude=…, read_only=…)`:

```python
from linkedin_toolkit import LinkedInToolkit
from linkedin_toolkit.integrations.langchain import get_tools
from langgraph.prebuilt import create_react_agent

client = LinkedInToolkit()
agent = create_react_agent(model, get_tools(client))
```

`read_only=True` drops every tool that writes to LinkedIn — the cheapest way to build a sourcing
agent that structurally cannot send anything. It is the default for smolagents, where a `CodeAgent`
generates loops.

An integration whose framework is not installed raises an `ImportError` naming the extra, at import
time, rather than failing somewhere deeper.

Failures inside a wrapper are returned to the model as data (`{"error": "CHALLENGE_DETECTED",
"message": …}`) rather than raised, because an exception aborts most agent loops and the model needs
to read the code to stop for the right reason. The client itself still raises.

## What you cannot change from here

- **Hard caps** live in the extension: 100 invites, 150 messages, 500 profile visits and 1,000
  search results per day. No parameter in this package raises them.
- **Copilot mode** is on by default. Writes return `{"status": "queued", "queueId": …}` and wait for
  a human. Report that as success.

## Regenerating

`linkedin_toolkit/tools.json` and `linkedin_toolkit/_actions.py` are generated from
`mcp-server/tools.json` and `mcp-server/openapi.json` by `python scripts/gen.py`. They are
committed, and `tests/test_gen.py` fails if they are stale.

## Licence

MIT.
