# LangChain

A ReAct agent (LangGraph's `create_react_agent`) with eight LinkedIn Toolkit tools.

## Run

```bash
npx linkedin-toolkit-mcp        # pair the extension once
lit serve --http --fake         # drop --fake for a real session

python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY=sk-...
export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.token' ~/.linkedin-toolkit/config.json)
python source_and_draft.py "Heads of data engineering at Series B fintechs in London"
```

On Windows PowerShell:

```powershell
$env:LINKEDIN_TOOLKIT_TOKEN = (Get-Content "$env:USERPROFILE\.linkedin-toolkit\config.json" | ConvertFrom-Json).token
```

## What it shows

- **One `action()` function** is the entire integration. Everything else is `@tool` metadata.
- **`ToolkitError` carries `code`.** `RATE_LIMITED`, `QUOTA_EXCEEDED`, `CHALLENGE_DETECTED` reach
  the model as text with `howToFix` attached, so it explains rather than retries.
- **Docstrings are the tool descriptions**, and they do real work: `linkedin_send_invite`'s
  docstring states that `queued` is success, which is the difference between an agent that
  reports the queue and one that treats Copilot mode as an obstacle.
- **A client-side length guard** on the invite note, so the model gets told "that is 340
  characters" instead of burning a round trip on a rejection.

## Swapping the model

Any LangChain chat model with tool calling works — this is not OpenAI-specific:

```python
from langchain_anthropic import ChatAnthropic
agent = create_react_agent(ChatAnthropic(model="claude-sonnet-4-5"), TOOLS, prompt=SYSTEM)
```

Local, if you would rather nothing left the machine at all:

```python
from langchain_ollama import ChatOllama
agent = create_react_agent(ChatOllama(model="llama3.1:8b"), TOOLS, prompt=SYSTEM)
```

The toolkit is already local-first; pairing it with a local model means the profile data never
reaches any third party.

## Adding more tools

Every action in [`../../docs/actions.md`](../../docs/actions.md) is `POST /actions/{action}` with
the params as the body:

```python
@tool
def linkedin_get_post_engagers(post_url: str, kind: str = "both", count: int = 100) -> str:
    """Everyone who liked or commented on a post."""
    return json.dumps(action("post.engagers", postUrl=post_url, kind=kind, count=count))
```

Once `linkedin-toolkit` is on PyPI, `from linkedin_toolkit.integrations.langchain import tools`
gives you all of them in one line. This example stays on raw HTTP so it runs today and shows you
what is on the wire.
