"""CrewAI wrapper — one ``BaseTool`` subclass per tool.

    from linkedin_toolkit import LinkedInToolkit
    from linkedin_toolkit.integrations.crewai import get_tools

    client = LinkedInToolkit()
    sourcer = Agent(role="LinkedIn Sourcer", goal="...",
                    tools=get_tools(client, read_only=True))
    writer  = Agent(role="Outreach Writer", goal="...",
                    tools=get_tools(client, include=["linkedin_get_profile",
                                                     "linkedin_send_invite"]))

Splitting a crew by failure mode is the point of the filter: a sourcer with no
write tools cannot send anything, whatever the task text says.

``pip install "linkedin-toolkit[crewai]"``
"""

from __future__ import annotations

from typing import Any, Optional, Type

from pydantic import BaseModel

from ._common import args_model, missing_dependency, run_tool

try:  # pragma: no cover - exercised by test_integrations
    from crewai.tools import BaseTool
except ImportError as cause:  # pragma: no cover
    raise missing_dependency("crewai", "crewai", cause)

__all__ = ["get_tools", "make_tool"]


def make_tool(client: Any, tool: dict[str, Any]) -> "BaseTool":
    """A ``BaseTool`` subclass, built per tool so CrewAI sees a real args schema."""
    schema: Type[BaseModel] = args_model(tool)

    class _LinkedInToolkitTool(BaseTool):
        name: str = tool["name"]
        description: str = tool["description"]
        args_schema: Type[BaseModel] = schema

        def _run(self, **kwargs: Any) -> str:
            return run_tool(client, tool["name"], kwargs)

    _LinkedInToolkitTool.__name__ = "".join(p.capitalize() for p in tool["name"].split("_")) + "Tool"
    return _LinkedInToolkitTool()


def get_tools(
    client: Any,
    include: Optional[list[str]] = None,
    exclude: Optional[list[str]] = None,
    read_only: bool = False,
) -> list["BaseTool"]:
    return [
        make_tool(client, tool)
        for tool in client.tools(include=include, exclude=exclude, read_only=read_only)
    ]
