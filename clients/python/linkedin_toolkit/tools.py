"""The tool definitions the MCP server advertises, read from the committed copy.

``tools.json`` here is a byte-for-byte copy of ``mcp-server/tools.json``, made by
``scripts/gen.py`` and checked by ``tests/test_gen.py``. Reading it locally means
``tools()`` works with the server stopped, and that an agent built on this
package sees exactly the 39 tools an MCP agent sees.
"""

from __future__ import annotations

import json
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

__all__ = ["TOOLS_PATH", "tools", "tool_by_name", "tools_version", "raw_tools"]

TOOLS_PATH = Path(__file__).resolve().parent / "tools.json"


@lru_cache(maxsize=1)
def _document() -> dict[str, Any]:
    return json.loads(TOOLS_PATH.read_text(encoding="utf-8"))


def tools_version() -> str:
    """The contract version these definitions were generated from."""
    return str(_document()["version"])


def raw_tools() -> list[dict[str, Any]]:
    """The entries as the server writes them: name, action, description, write, inputSchema.

    Deep-copied: the document is cached for the process, and a caller that
    edited a nested schema in place would change what every later caller sees.
    """
    return [deepcopy(tool) for tool in _document()["tools"]]


def tools(
    include: Optional[list[str]] = None,
    exclude: Optional[list[str]] = None,
    read_only: bool = False,
) -> list[dict[str, Any]]:
    """``[{name, description, parameters, action, write}]``.

    ``read_only=True`` drops every tool that writes to LinkedIn, which is the
    cheapest way to build an agent that structurally cannot send anything.
    """
    selected = raw_tools()
    if include is not None:
        wanted = set(include)
        selected = [t for t in selected if t["name"] in wanted]
    if exclude is not None:
        unwanted = set(exclude)
        selected = [t for t in selected if t["name"] not in unwanted]
    if read_only:
        selected = [t for t in selected if not t.get("write")]
    return [
        {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["inputSchema"],
            "action": tool.get("action"),
            "write": bool(tool.get("write")),
        }
        for tool in selected
    ]


def tool_by_name(name: str) -> dict[str, Any]:
    for tool in tools():
        if tool["name"] == name:
            return tool
    raise KeyError(f'Unknown tool "{name}".')
