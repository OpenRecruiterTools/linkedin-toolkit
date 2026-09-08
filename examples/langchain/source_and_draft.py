"""
LangChain · LinkedIn Toolkit

A ReAct agent that sources people and drafts invites. Reads and one write, over the HTTP
action API, so it runs against any version of the server.

    pip install -r requirements.txt
    export OPENAI_API_KEY=sk-...
    export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.token' ~/.linkedin-toolkit/config.json)
    python source_and_draft.py "Heads of data engineering at Series B fintechs in London"

Requires `lit serve --http` (add --fake to run without a LinkedIn account).
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Literal

import httpx
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

BASE = os.environ.get("LINKEDIN_TOOLKIT_URL", "http://127.0.0.1:47830")
TOKEN = os.environ.get("LINKEDIN_TOOLKIT_TOKEN")

if not TOKEN:
    sys.exit(
        "LINKEDIN_TOOLKIT_TOKEN is not set. It is the bridge token in "
        "~/.linkedin-toolkit/config.json"
    )

_client = httpx.Client(
    base_url=BASE,
    headers={"authorization": f"Bearer {TOKEN}"},
    timeout=120.0,
)


class ToolkitError(RuntimeError):
    """A structured error from the engine. Terminal — never retry these in a loop."""

    def __init__(self, code: str, message: str, how_to_fix: str | None = None) -> None:
        self.code = code
        super().__init__(f"{code}: {message}" + (f" — {how_to_fix}" if how_to_fix else ""))


def action(name: str, **params: Any) -> Any:
    """POST /actions/{name}, unwrap the envelope, raise structured errors."""
    params = {k: v for k, v in params.items() if v is not None}
    envelope = _client.post(f"/actions/{name}", json=params).json()
    if not envelope.get("ok"):
        err = envelope.get("error", {})
        raise ToolkitError(
            err.get("code", "INTERNAL"), err.get("message", "unknown"), err.get("howToFix")
        )
    return envelope["data"]


# --------------------------------------------------------------------------- tools


@tool
def linkedin_get_status() -> str:
    """Connection state, login state, Copilot/Autopilot mode, business hours, remaining daily and
    hourly quota per action type, and queue depth. Call this before anything else."""
    return json.dumps(action("status.get"))


@tool
def linkedin_search_people(
    keywords: str,
    title: str | None = None,
    company: str | None = None,
    location: str | None = None,
    source: Literal["search", "salesnav", "recruiter"] = "search",
    start: int | None = None,
    count: int = 50,
) -> str:
    """Search LinkedIn for people and return normalised profiles. `count` is capped at 100 per
    call; page by passing the returned `nextStart` back as `start`. Each result spends search
    quota."""
    return json.dumps(
        action(
            "search.people",
            keywords=keywords,
            title=title,
            company=company,
            location=location,
            source=source,
            start=start,
            count=min(count, 100),
        )
    )


@tool
def linkedin_get_profile(public_id: str, full: bool = False) -> str:
    """One profile by publicId. `full=True` adds page text and photo and spends one profile visit
    from the daily cap — use it only for finalists."""
    return json.dumps(action("profile.get", publicId=public_id, full=full))


@tool
def linkedin_get_connection_status(public_ids: list[str]) -> str:
    """Batch check whether you are 'connected', have a 'pending' invite, or have 'none'. Always
    call this before drafting invites."""
    return json.dumps(action("network.status", publicIds=public_ids))


@tool
def linkedin_list_create(name: str, tags: list[str] | None = None) -> str:
    """Create a named list to hold a shortlist."""
    return json.dumps(action("list.create", name=name, tags=tags or []))


@tool
def linkedin_list_add(list_id: str, public_ids: list[str]) -> str:
    """Add profiles to a list by publicId. Returns how many were added and how many were
    duplicates."""
    return json.dumps(action("list.add", listId=list_id, publicIds=public_ids))


@tool
def linkedin_send_invite(public_id: str, note: str | None = None, dry_run: bool = False) -> str:
    """Send a connection invite with an optional note (300 characters maximum). In Copilot mode —
    the default — this QUEUES the invite for human approval and returns
    {"status": "queued", "queueId": ...}. That is success, not failure. Pass dry_run=True to see
    exactly what would be sent without queuing anything."""
    if note is not None and len(note) > 300:
        return json.dumps({"error": f"note is {len(note)} characters; LinkedIn's limit is 300"})
    return json.dumps(action("outreach.invite", publicId=public_id, note=note, dry_run=dry_run))


@tool
def linkedin_queue_list(status: str = "pending") -> str:
    """What is waiting in the human approval queue. Status is one of pending, approved, rejected,
    sent."""
    return json.dumps(action("queue.list", status=status))


TOOLS = [
    linkedin_get_status,
    linkedin_search_people,
    linkedin_get_profile,
    linkedin_get_connection_status,
    linkedin_list_create,
    linkedin_list_add,
    linkedin_send_invite,
    linkedin_queue_list,
]

SYSTEM = """You source people on LinkedIn through the LinkedIn Toolkit.

Order of work:
1. linkedin_get_status. If connected or loggedIn is false, or a challenge is set, stop and say so.
   Plan inside the remaining search and invite quota.
2. Two to four searches with varied title synonyms, not one broad query.
3. Deduplicate by publicId.
4. linkedin_get_connection_status on the survivors. Never draft an invite for someone already
   connected or already pending.
5. Score against the brief using only fields the tools returned, one line of reasoning each.
6. linkedin_get_profile with full=True for finalists only — each one costs visit quota.
7. Create a list and add the shortlist.
8. Draft invite notes under 300 characters, each hanging on a specific fact from that person's own
   profile. No flattery, no "I came across your profile", no invented facts.
9. dry_run the first invite and show it before queuing the rest.
10. Finish with linkedin_queue_list and tell the user where their drafts are.

Rules you do not break:
- Never invent a fact, a publicId, a company, or a tenure.
- RATE_LIMITED, QUOTA_EXCEEDED and CHALLENGE_DETECTED are terminal. Report and stop.
- Writes queue for human approval. Never claim something was sent unless the result said "sent".
"""


def main() -> None:
    brief = " ".join(sys.argv[1:])
    if not brief:
        sys.exit('usage: python source_and_draft.py "<brief>"')

    agent = create_react_agent(
        ChatOpenAI(model="gpt-4.1", temperature=0),
        TOOLS,
        prompt=SYSTEM,
    )

    for chunk in agent.stream(
        {
            "messages": [
                ("user", f"Source 20 people for this brief and draft invites for the top 8: {brief}")
            ]
        },
        stream_mode="values",
    ):
        chunk["messages"][-1].pretty_print()


if __name__ == "__main__":
    main()
