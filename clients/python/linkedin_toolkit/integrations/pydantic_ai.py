"""Pydantic AI wrapper — a list of ``Tool`` objects.

    from linkedin_toolkit import LinkedInToolkit
    from linkedin_toolkit.integrations.pydantic_ai import get_tools
    from pydantic_ai import Agent

    agent = Agent("openai:gpt-4.1", tools=get_tools(LinkedInToolkit()),
                  output_type=list[Person])

``output_type`` is the reason to use Pydantic AI here: a validated result means
the model cannot hand back a shortlist with a missing ``publicId``.

Note that a terminal error (``RATE_LIMITED``, ``QUOTA_EXCEEDED``,
``CHALLENGE_DETECTED``) is returned as data, not raised as ``ModelRetry``.
Retrying after a challenge is the specific behaviour that turns a warning into a
restriction, so the model is told what happened and asked to stop.

``pip install "linkedin-toolkit[pydantic-ai]"``
"""

from __future__ import annotations

from typing import Any, Optional

from ._common import make_function, missing_dependency

try:  # pragma: no cover - exercised by test_integrations
    from pydantic_ai import Tool
except ImportError as cause:  # pragma: no cover
    raise missing_dependency("pydantic-ai", "pydantic-ai", cause)

__all__ = ["get_tools", "make_tool"]


def make_tool(client: Any, tool: dict[str, Any]) -> "Tool":
    return Tool(
        make_function(client, tool),
        name=tool["name"],
        description=tool["description"],
        takes_ctx=False,
    )


def get_tools(
    client: Any,
    include: Optional[list[str]] = None,
    exclude: Optional[list[str]] = None,
    read_only: bool = False,
) -> list["Tool"]:
    return [
        make_tool(client, tool)
        for tool in client.tools(include=include, exclude=exclude, read_only=read_only)
    ]
