"""LlamaIndex wrapper — one ``FunctionTool`` per tool.

    from linkedin_toolkit import LinkedInToolkit
    from linkedin_toolkit.integrations.llama_index import get_tools
    from llama_index.core.agent.workflow import FunctionAgent

    agent = FunctionAgent(tools=get_tools(LinkedInToolkit()), llm=llm)

LlamaIndex builds the schema from the function signature and the docstring, so
the generated functions carry both — including the quota cost in the
description, which is the part a model needs before it spends any.

``pip install "linkedin-toolkit[llamaindex]"``
"""

from __future__ import annotations

from typing import Any, Optional

from ._common import make_function, missing_dependency

try:  # pragma: no cover - exercised by test_integrations
    from llama_index.core.tools import FunctionTool
except ImportError as cause:  # pragma: no cover
    raise missing_dependency("llama-index-core", "llamaindex", cause)

__all__ = ["get_tools", "make_tool"]


def make_tool(client: Any, tool: dict[str, Any]) -> "FunctionTool":
    return FunctionTool.from_defaults(
        fn=make_function(client, tool),
        name=tool["name"],
        description=tool["description"],
    )


def get_tools(
    client: Any,
    include: Optional[list[str]] = None,
    exclude: Optional[list[str]] = None,
    read_only: bool = False,
) -> list["FunctionTool"]:
    return [
        make_tool(client, tool)
        for tool in client.tools(include=include, exclude=exclude, read_only=read_only)
    ]
