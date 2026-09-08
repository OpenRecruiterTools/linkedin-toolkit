#!/usr/bin/env python3
"""Regenerate the parts of this package that must never drift from the server.

Two files are written into ``linkedin_toolkit/``:

    tools.json    a byte-for-byte copy of ``mcp-server/tools.json``
    _actions.py   one typed keyword-only method per action, from ``mcp-server/openapi.json``

Both are committed. ``tests/test_gen.py`` regenerates them into a temporary
directory and fails if the committed copies differ, so a contract change that
is not regenerated cannot pass CI.

Run it with ``python scripts/gen.py`` from ``clients/python``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = PACKAGE_ROOT.parent.parent
TOOLS_SOURCE = REPO_ROOT / "mcp-server" / "tools.json"
OPENAPI_SOURCE = REPO_ROOT / "mcp-server" / "openapi.json"

BANNER = '''"""AUTO-GENERATED — do not edit by hand.

Written by ``scripts/gen.py`` from ``mcp-server/openapi.json``, one method per
action in the contract. ``LinkedInToolkit`` and ``AsyncLinkedInToolkit`` both
inherit from this mixin: ``_invoke`` returns a value in the sync client and a
coroutine in the async one, so the same generated body serves both.
"""

from __future__ import annotations

from typing import Any, Optional

__all__ = ["ActionMethods", "ACTION_METHODS"]
'''


def action_to_method(action: str) -> str:
    """``search.people`` -> ``search_people``; ``list.getAll`` -> ``list_get_all``."""
    flat = action.replace(".", "_")
    return re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", flat).lower()


def resolve(schema: dict[str, Any], document: dict[str, Any], depth: int = 0) -> dict[str, Any]:
    """Follow a local ``$ref``. Bounded, because ``Step`` refers to itself."""
    while "$ref" in schema and depth < 8:
        pointer = schema["$ref"]
        if not pointer.startswith("#/"):
            return {}
        node: Any = document
        for part in pointer[2:].split("/"):
            if not isinstance(node, dict) or part not in node:
                return {}
            node = node[part]
        if not isinstance(node, dict):
            return {}
        schema = node
        depth += 1
    return schema


def python_type(schema: dict[str, Any], document: dict[str, Any] | None = None) -> str:
    """A permissive annotation for one JSON Schema node.

    Deliberately shallow: nested contract objects become ``dict[str, Any]``
    rather than generated dataclasses, because the extension is authoritative
    about result shapes and a strict client would reject a field it had not
    heard of yet.
    """
    if document is not None:
        schema = resolve(schema, document)
    if "$ref" in schema:
        return "dict[str, Any]"
    kind = schema.get("type")
    if kind == "string":
        return "str"
    if kind == "integer":
        return "int"
    if kind == "number":
        return "float"
    if kind == "boolean":
        return "bool"
    if kind == "array":
        return f"list[{python_type(schema.get('items') or {}, document)}]"
    if kind == "object":
        return "dict[str, Any]"
    return "Any"


def describe(schema: dict[str, Any], document: dict[str, Any] | None = None) -> str:
    if document is not None:
        schema = resolve(schema, document)
    parts: list[str] = []
    if "enum" in schema:
        parts.append("one of " + ", ".join(json.dumps(v) for v in schema["enum"]))
    if "minimum" in schema:
        parts.append(f"min {schema['minimum']}")
    if "maximum" in schema:
        parts.append(f"max {schema['maximum']}")
    return f" ({'; '.join(parts)})" if parts else ""


def wrap(text: str, width: int, indent: str) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) + len(indent) > width and current:
            lines.append(indent + current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(indent + current)
    return lines


def generate_actions() -> str:
    openapi = json.loads(OPENAPI_SOURCE.read_text(encoding="utf-8"))
    tools = json.loads(TOOLS_SOURCE.read_text(encoding="utf-8"))["tools"]
    tool_by_action = {t["action"]: t for t in tools if t.get("action")}
    write_actions = {t["action"] for t in tools if t.get("write") and t.get("action")}

    lines: list[str] = [BANNER, "", "", "class ActionMethods:", '    """Every action in the contract, as a keyword-only method."""', ""]
    lines.append("    def _invoke(self, action: str, params: dict[str, Any]) -> Any:  # pragma: no cover")
    lines.append("        raise NotImplementedError")
    lines.append("")

    methods: dict[str, str] = {}

    for path, item in openapi["paths"].items():
        if not path.startswith("/actions/"):
            continue
        action = path[len("/actions/") :]
        schema = item["post"]["requestBody"]["content"]["application/json"]["schema"]
        properties: dict[str, Any] = schema.get("properties") or {}
        required = set(schema.get("required") or [])
        method = action_to_method(action)
        methods[action] = method

        args = [f"{name}: {python_type(spec, openapi)}" for name, spec in properties.items() if name in required]
        args += [
            f"{name}: Optional[{python_type(spec, openapi)}] = None"
            for name, spec in properties.items()
            if name not in required
        ]
        if action in write_actions:
            args.append("dry_run: Optional[bool] = None")

        signature = "self, *, " + ", ".join(args) if args else "self"
        lines.append(f"    def {method}({signature}) -> Any:")

        tool = tool_by_action.get(action)
        description = tool["description"] if tool else item["post"].get("description") or f"Call the {action} action."
        lines.append('        """' + f"``{action}``.")
        lines.append("")
        lines.extend(wrap(description, 96, "        "))
        if properties:
            lines.append("")
            lines.append("        Args:")
            for name, spec in properties.items():
                suffix = "" if name in required else " Optional."
                lines.extend(
                    wrap(
                        f"{name} ({python_type(spec, openapi)}): {'Required.' if name in required else ''}"
                        f"{describe(spec, openapi)}{suffix}".strip(),
                        96,
                        "            ",
                    )
                )
            if action in write_actions:
                lines.extend(
                    wrap(
                        "dry_run (bool): Preview the write without queueing or sending it. Optional.",
                        96,
                        "            ",
                    )
                )
        lines.append('        """')

        names = list(properties) + (["dry_run"] if action in write_actions else [])
        if names:
            pairs = ", ".join(f'"{name}": {name}' for name in names)
            lines.append(f"        params = {{{pairs}}}")
            lines.append('        return self._invoke("' + action + '", {k: v for k, v in params.items() if v is not None})')
        else:
            lines.append(f'        return self._invoke("{action}", {{}})')
        lines.append("")

    lines.append("")
    lines.append("#: Every action, and the method name this package exposes it under.")
    lines.append("ACTION_METHODS: dict[str, str] = {")
    for action, method in methods.items():
        lines.append(f'    "{action}": "{method}",')
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def generate(out_dir: Path) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = {
        "tools": out_dir / "tools.json",
        "actions": out_dir / "_actions.py",
    }
    written["tools"].write_text(TOOLS_SOURCE.read_text(encoding="utf-8"), encoding="utf-8", newline="")
    written["actions"].write_text(generate_actions(), encoding="utf-8", newline="")
    return written


if __name__ == "__main__":
    for path in generate(PACKAGE_ROOT / "linkedin_toolkit").values():
        print(f"wrote {path}")
