"""AutoGen wrapper — plain functions with real signatures and docstrings.

AutoGen builds a tool schema from ``inspect.signature`` and the docstring, so
that is what this module produces. Both the modern ``autogen-agentchat`` API and
the older ``register_function`` flow are covered.

    from linkedin_toolkit import LinkedInToolkit
    from linkedin_toolkit.integrations.autogen import get_tools

    sourcer = AssistantAgent(name="linkedin_sourcer", model_client=model,
                             tools=get_tools(LinkedInToolkit(), read_only=True))

For the two-agent conversable pattern:

    register_tools(client, caller=assistant, executor=user_proxy)

``pip install "linkedin-toolkit[autogen]"``
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from ._common import make_function, missing_dependency

try:  # pragma: no cover - exercised by test_integrations
    import autogen_core  # noqa: F401  (import proves the dependency is present)
except ImportError as cause:  # pragma: no cover
    try:
        import autogen  # noqa: F401
    except ImportError:
        raise missing_dependency("autogen-agentchat", "autogen", cause)

__all__ = ["get_tools", "register_tools"]


def get_tools(
    client: Any,
    include: Optional[list[str]] = None,
    exclude: Optional[list[str]] = None,
    read_only: bool = False,
) -> list[Callable[..., Any]]:
    """Functions ready to hand to ``AssistantAgent(tools=...)``."""
    return [
        make_function(client, tool)
        for tool in client.tools(include=include, exclude=exclude, read_only=read_only)
    ]


def register_tools(
    client: Any,
    caller: Any,
    executor: Any,
    include: Optional[list[str]] = None,
    exclude: Optional[list[str]] = None,
    read_only: bool = False,
) -> list[Callable[..., Any]]:
    """Register every tool with a caller/executor pair (``ConversableAgent`` style).

    The proxy gates whether the agent *calls* a tool; the toolkit's approval
    queue gates whether a message *sends*. They solve different halves of the
    same problem — use both.
    """
    try:
        from autogen import register_function
    except ImportError as cause:  # pragma: no cover
        raise missing_dependency("autogen (register_function)", "autogen", cause)

    functions = get_tools(client, include=include, exclude=exclude, read_only=read_only)
    for function in functions:
        register_function(
            function,
            caller=caller,
            executor=executor,
            name=function.__name__,
            description=(function.__doc__ or "").split("\n", 1)[0],
        )
    return functions
