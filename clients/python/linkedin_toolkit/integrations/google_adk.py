"""Google Agent Development Kit wrapper — one ``FunctionTool`` per tool.

    from linkedin_toolkit import LinkedInToolkit
    from linkedin_toolkit.integrations.google_adk import get_tools
    from google.adk.agents import Agent

    root_agent = Agent(name="linkedin_sourcer", model="gemini-2.0-flash",
                       tools=get_tools(LinkedInToolkit()))

ADK reads the docstring and the type hints to build the schema, so the ``Args:``
and ``Returns:`` sections of the generated functions are load-bearing. The
functions return a dict with a ``status`` key, which is the ADK convention and
makes an error legible to the model rather than a stack trace.

``pip install "linkedin-toolkit[google-adk]"``
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from ._common import make_function, missing_dependency

try:  # pragma: no cover - exercised by test_integrations
    from google.adk.tools import FunctionTool
except ImportError as cause:  # pragma: no cover
    raise missing_dependency("google-adk", "google-adk", cause)

__all__ = ["get_tools", "get_functions", "make_tool"]


def _adk_function(client: Any, tool: dict[str, Any]) -> Callable[..., Any]:
    """The generated function, wrapped so the result follows the ADK convention."""
    inner = make_function(client, tool, as_json=False)

    def wrapper(**kwargs: Any) -> dict[str, Any]:
        result = inner(**kwargs)
        if isinstance(result, dict) and "error" in result and "message" in result:
            return {
                "status": "error",
                "error_code": result["error"],
                "error_message": result["message"],
            }
        return {"status": "success", "data": result}

    wrapper.__name__ = inner.__name__
    wrapper.__doc__ = inner.__doc__
    wrapper.__signature__ = __import__("inspect").signature(inner)  # type: ignore[attr-defined]
    wrapper.__annotations__ = dict(getattr(inner, "__annotations__", {}))
    wrapper.__annotations__["return"] = dict
    return wrapper


def get_functions(
    client: Any,
    include: Optional[list[str]] = None,
    exclude: Optional[list[str]] = None,
    read_only: bool = False,
) -> list[Callable[..., Any]]:
    """The bare functions, for ``Agent(tools=[...])`` without the FunctionTool wrapper."""
    return [
        _adk_function(client, tool)
        for tool in client.tools(include=include, exclude=exclude, read_only=read_only)
    ]


def make_tool(client: Any, tool: dict[str, Any]) -> "FunctionTool":
    return FunctionTool(func=_adk_function(client, tool))


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
