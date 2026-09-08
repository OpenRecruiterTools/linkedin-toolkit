"""
CrewAI · LinkedIn Toolkit

Two agents, two tasks: a sourcer builds a shortlist, a writer drafts the outreach. Every draft
lands in the human approval queue.

    pip install -r requirements.txt
    export OPENAI_API_KEY=sk-...
    export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.bridge.token' ~/.linkedin-toolkit/config.json)
    python research_crew.py "Heads of data engineering at Series B fintechs in London"

Requires `lit serve --http` (add --fake to run without a LinkedIn account).
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Type

import httpx
from crewai import Agent, Crew, Process, Task
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

BASE = os.environ.get("LINKEDIN_TOOLKIT_URL", "http://127.0.0.1:47830")
TOKEN = os.environ.get("LINKEDIN_TOOLKIT_TOKEN")

if not TOKEN:
    sys.exit(
        "LINKEDIN_TOOLKIT_TOKEN is not set. It is the bridge token in "
        "~/.linkedin-toolkit/config.json"
    )

_client = httpx.Client(
    base_url=BASE, headers={"authorization": f"Bearer {TOKEN}"}, timeout=120.0
)


def action(name: str, **params: Any) -> Any:
    """POST /actions/{name} and unwrap the envelope. Errors come back as a dict the agent can
    read rather than an exception that kills the crew — CrewAI handles a bad tool result far
    better than a traceback."""
    params = {k: v for k, v in params.items() if v is not None}
    envelope = _client.post(f"/actions/{name}", json=params).json()
    if not envelope.get("ok"):
        err = envelope.get("error", {})
        return {
            "error": err.get("code", "INTERNAL"),
            "message": err.get("message"),
            "howToFix": err.get("howToFix"),
            "terminal": err.get("code")
            in {"RATE_LIMITED", "QUOTA_EXCEEDED", "CHALLENGE_DETECTED", "NOT_LOGGED_IN", "EXTENSION_OFFLINE"},
        }
    return envelope["data"]


# --------------------------------------------------------------------------- tools


class NoArgs(BaseModel):
    pass


class StatusTool(BaseTool):
    name: str = "linkedin_get_status"
    description: str = (
        "Connection state, login state, Copilot/Autopilot mode, business hours, remaining daily "
        "and hourly quota per action type, and queue depth. Call this before anything else."
    )
    args_schema: Type[BaseModel] = NoArgs

    def _run(self) -> str:
        return json.dumps(action("status.get"))


class SearchArgs(BaseModel):
    keywords: str = Field(description="Free-text search terms")
    title: str | None = Field(default=None, description="Job title filter")
    company: str | None = None
    location: str | None = None
    count: int = Field(default=50, le=100, description="Maximum 100 per call")


class SearchTool(BaseTool):
    name: str = "linkedin_search_people"
    description: str = (
        "Search LinkedIn for people and return normalised profiles. Capped at 100 per call. "
        "Each result spends search quota from the daily cap."
    )
    args_schema: Type[BaseModel] = SearchArgs

    def _run(self, keywords: str, title=None, company=None, location=None, count=50) -> str:
        return json.dumps(
            action(
                "search.people",
                keywords=keywords,
                title=title,
                company=company,
                location=location,
                source="search",
                count=min(count, 100),
            )
        )


class ProfileArgs(BaseModel):
    public_id: str
    full: bool = Field(default=False, description="Adds page text and photo; costs one visit")


class ProfileTool(BaseTool):
    name: str = "linkedin_get_profile"
    description: str = (
        "One profile by publicId. full=True adds page text and photo and spends one profile "
        "visit from the daily cap — finalists only."
    )
    args_schema: Type[BaseModel] = ProfileArgs

    def _run(self, public_id: str, full: bool = False) -> str:
        return json.dumps(action("profile.get", publicId=public_id, full=full))


class ConnectionArgs(BaseModel):
    public_ids: list[str]


class ConnectionStatusTool(BaseTool):
    name: str = "linkedin_get_connection_status"
    description: str = (
        "Batch check: 'connected', 'pending', or 'none' per publicId. Always call before "
        "drafting invites — never invite someone already connected or pending."
    )
    args_schema: Type[BaseModel] = ConnectionArgs

    def _run(self, public_ids: list[str]) -> str:
        return json.dumps(action("network.status", publicIds=public_ids))


class InviteArgs(BaseModel):
    public_id: str
    note: str | None = Field(default=None, max_length=300)
    dry_run: bool = False


class InviteTool(BaseTool):
    name: str = "linkedin_send_invite"
    description: str = (
        "Send a connection invite with an optional note (300 characters maximum). In Copilot "
        "mode — the default — this QUEUES the invite for human approval and returns "
        '{"status": "queued", "queueId": ...}. That is success, not failure. Use dry_run=True to '
        "see exactly what would be sent without queuing anything."
    )
    args_schema: Type[BaseModel] = InviteArgs

    def _run(self, public_id: str, note: str | None = None, dry_run: bool = False) -> str:
        if note and len(note) > 300:
            return json.dumps({"error": f"note is {len(note)} characters; the limit is 300"})
        return json.dumps(
            action("outreach.invite", publicId=public_id, note=note, dry_run=dry_run)
        )


class QueueArgs(BaseModel):
    status: str = "pending"


class QueueTool(BaseTool):
    name: str = "linkedin_queue_list"
    description: str = "What is waiting in the human approval queue."
    args_schema: Type[BaseModel] = QueueArgs

    def _run(self, status: str = "pending") -> str:
        return json.dumps(action("queue.list", status=status))


# --------------------------------------------------------------------------- crew

GUARDRAILS = """
You never invent a fact, a publicId, a company, or a tenure — everything comes from a tool result.
RATE_LIMITED, QUOTA_EXCEEDED and CHALLENGE_DETECTED are terminal: report them and stop, never
retry. Writes queue for human approval; you never claim anything was sent.
"""

sourcer = Agent(
    role="LinkedIn Sourcer",
    goal="Build a deduplicated, scored shortlist that matches the brief and nothing else.",
    backstory=(
        "A researcher who would rather return eight right names than forty plausible ones. "
        "Checks quota before spending it and connection status before wasting an invite." + GUARDRAILS
    ),
    tools=[StatusTool(), SearchTool(), ProfileTool(), ConnectionStatusTool()],
    verbose=True,
    allow_delegation=False,
)

writer = Agent(
    role="Outreach Writer",
    goal="Write connection notes a real person would reply to, under 300 characters, from facts only.",
    backstory=(
        "Has read enough template outreach to know what fails. Finds the one specific thing in a "
        "profile worth mentioning and leads with it. Refuses to write flattery." + GUARDRAILS
    ),
    tools=[ProfileTool(), InviteTool(), QueueTool()],
    verbose=True,
    allow_delegation=False,
)


def build_crew(brief: str) -> Crew:
    source_task = Task(
        description=(
            f"Source people matching this brief: {brief}\n\n"
            "1. Check status first and plan inside the remaining quota.\n"
            "2. Run two to four searches with varied title synonyms — not one broad query.\n"
            "3. Deduplicate by publicId.\n"
            "4. Check connection status; drop anyone already connected or pending.\n"
            "5. Score the rest 0-100 against the brief with one line of reasoning each.\n"
            "6. Full-capture the top 8 only."
        ),
        expected_output=(
            "A markdown table of the top 8: publicId, name, title, company, location, score, and "
            "the one-line reason. Below it, the facts from each full profile that outreach could "
            "hang on. State explicitly how many were dropped and why."
        ),
        agent=sourcer,
    )

    write_task = Task(
        description=(
            "Write a connection note for each of the 8, using only facts from the sourcing step.\n"
            "Under 300 characters. One specific hook from their own profile, one clause on why "
            "you, one low-friction ask. No flattery, no 'I came across your profile'.\n"
            "Dry-run the first one and show the result, then queue all eight.\n"
            "Finish by listing the approval queue."
        ),
        expected_output=(
            "The 8 notes with character counts and the hook each one used, the dry-run result, "
            "the queue ids, and a closing line telling the user the drafts are waiting in the "
            "extension popup's Queue tab and nothing has been sent."
        ),
        agent=writer,
        context=[source_task],
    )

    return Crew(
        agents=[sourcer, writer],
        tasks=[source_task, write_task],
        process=Process.sequential,
        verbose=True,
    )


if __name__ == "__main__":
    brief_arg = " ".join(sys.argv[1:])
    if not brief_arg:
        sys.exit('usage: python research_crew.py "<brief>"')
    print(build_crew(brief_arg).kickoff())
