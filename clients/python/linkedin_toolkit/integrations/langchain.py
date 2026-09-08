"""LangChain wrapper — one ``StructuredTool`` per tool.

    from linkedin_toolkit import LinkedInToolkit
    from linkedin_toolkit.integrations.langchain import get_tools
    from langgraph.prebuilt import create_react_agent

    agent = create_react_agent(model, get_tools(LinkedInToolkit()))

``pip install "linkedin-toolkit[langchain]"``
"""

from __future__ import annotations

from typing import Any, Optional

from ._common import args_model, missing_dependency, run_tool

try:  # pragma: no cover - exercised by test_integrations
    from langchain_core.tools import StructuredTool
except ImportError as cause:  # pragma: no cover
    raise missing_dependency("langchain-core", "langchain", cause)

__all__ = ["get_tools", "make_tool"]


def make_tool(client: Any, tool: dict[str, Any]) -> "StructuredTool":
    """One tool. The result is JSON, because LangChain hands the model a string."""

    def _call(**kwargs: Any) -> str:
        return run_tool(client, tool["name"], kwargs)

    return StructuredTool.from_function(
        func=_call,
        name=tool["name"],
        description=tool["description"],
        args_schema=args_model(tool),
    )


def get_tools(
    client: Any,
    include: Optional[list[str]] = None,
    exclude: Optional[list[str]] = None,
    read_only: bool = False,
) -> list["StructuredTool"]:
    """Every tool the toolkit exposes, as LangChain tools."""
    return [
        make_tool(client, tool)
        for tool in client.tools(include=include, exclude=exclude, read_only=read_only)
    ]
