"""Shared plumbing for the framework wrappers.

Three jobs:

* turn a tool's JSON Schema into a pydantic model, for the frameworks that want
  ``args_schema``;
* build a real Python function with a real signature and a Google-style
  docstring, for the frameworks that read ``inspect.signature`` and the
  docstring instead (AutoGen, Google ADK, LlamaIndex, Pydantic AI);
* fail with a sentence that names the extra to install, rather than a bare
  ``ModuleNotFoundError`` from three frames down.

Parameter names are the contract's names, verbatim — ``publicId``, not
``public_id``. One vocabulary across MCP, HTTP, the docs and every wrapper is
worth more than idiomatic casing in one of them.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from pydantic import BaseModel, ConfigDict, Field, create_model

from ..errors import LinkedInToolkitError

__all__ = [
    "missing_dependency",
    "args_model",
    "python_annotation",
    "make_function",
    "run_tool",
    "tool_docstring",
]

_TYPES: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "array": list,
    "object": dict,
}


def missing_dependency(framework: str, extra: str, cause: Exception) -> ImportError:
    """The error each integration raises when its framework is not installed.

    Returned rather than raised so the call site reads ``raise
    missing_dependency(...)``; the original ``ImportError`` is attached as the
    cause so the traceback still names the module that was actually missing.
    """
    error = ImportError(
        f"linkedin_toolkit.integrations.{extra.replace('-', '_')} needs {framework}. "
        f'Install it with: pip install "linkedin-toolkit[{extra}]"'
    )
    error.__cause__ = cause
    return error


def python_annotation(schema: dict[str, Any]) -> Any:
    """A permissive annotation for one JSON Schema node."""
    kind = schema.get("type")
    if kind == "array":
        item = schema.get("items") or {}
        inner = python_annotation(item) if item else Any
        return list[inner]  # type: ignore[valid-type]
    return _TYPES.get(kind, Any) if isinstance(kind, str) else Any


def _field_description(name: str, schema: dict[str, Any]) -> str:
    parts: list[str] = []
    if "enum" in schema:
        parts.append("one of " + ", ".join(json.dumps(v) for v in schema["enum"]))
    if "minimum" in schema:
        parts.append(f"minimum {schema['minimum']}")
    if "maximum" in schema:
        parts.append(f"maximum {schema['maximum']}")
    if name == "dry_run":
        parts.append("preview the write without queueing or sending it")
    return "; ".join(parts) or name


def args_model(tool: dict[str, Any]) -> type[BaseModel]:
    """A pydantic model for a tool's arguments, for ``args_schema``-style frameworks."""
    schema: dict[str, Any] = tool.get("parameters") or {}
    properties: dict[str, Any] = schema.get("properties") or {}
    required = set(schema.get("required") or [])

    fields: dict[str, Any] = {}
    for name, spec in properties.items():
        annotation = python_annotation(spec)
        description = _field_description(name, spec)
        if name in required:
            fields[name] = (annotation, Field(description=description))
        else:
            fields[name] = (Optional[annotation], Field(default=None, description=description))

    model = create_model(
        f"{_camel(tool['name'])}Args",
        __config__=ConfigDict(extra="allow"),
        **fields,
    )
    model.__doc__ = tool["description"]
    return model


def _camel(name: str) -> str:
    return "".join(part.capitalize() for part in name.split("_"))


def tool_docstring(tool: dict[str, Any]) -> str:
    """A Google-style docstring. Several frameworks parse the ``Args:`` block."""
    schema: dict[str, Any] = tool.get("parameters") or {}
    properties: dict[str, Any] = schema.get("properties") or {}
    required = set(schema.get("required") or [])

    lines = [tool["description"], ""]
    if properties:
        lines.append("Args:")
        for name, spec in properties.items():
            annotation = python_annotation(spec)
            type_name = getattr(annotation, "__name__", str(annotation))
            optional = "" if name in required else " Optional."
            lines.append(f"    {name} ({type_name}): {_field_description(name, spec)}.{optional}")
        lines.append("")
    lines.append("Returns:")
    lines.append("    str: The action's result as JSON, or an error object with code and message.")
    return "\n".join(lines)


def run_tool(client: Any, name: str, arguments: dict[str, Any], as_json: bool = True) -> Any:
    """Call a tool and shape the failure the way agent frameworks cope with best.

    A raised exception aborts most agent loops. Returning the error as data lets
    the model read ``CHALLENGE_DETECTED`` and stop for the right reason — which
    is what every page in ``docs/agents`` tells it to do.
    """
    cleaned = {k: v for k, v in arguments.items() if v is not None}
    try:
        result = client.call_tool(name, cleaned)
    except LinkedInToolkitError as error:
        result = error.to_dict()
    return json.dumps(result, default=str) if as_json else result


def make_function(
    client: Any,
    tool: dict[str, Any],
    as_json: bool = True,
) -> Callable[..., Any]:
    """Build a function with the tool's real signature, name and docstring.

    Generated with ``exec`` rather than ``*args, **kwargs`` because AutoGen,
    Google ADK and LlamaIndex all build their schema from
    ``inspect.signature``, and a catch-all signature gives the model nothing.
    """
    schema: dict[str, Any] = tool.get("parameters") or {}
    properties: dict[str, Any] = schema.get("properties") or {}
    required = [name for name in properties if name in set(schema.get("required") or [])]
    optional = [name for name in properties if name not in set(schema.get("required") or [])]

    namespace: dict[str, Any] = {
        "_run": run_tool,
        "_client": client,
        "_name": tool["name"],
        "_as_json": as_json,
        "Any": Any,
        "Optional": Optional,
    }
    for name in properties:
        namespace[f"_type_{name}"] = python_annotation(properties[name])

    parts = [f"{name}: _type_{name}" for name in required]
    parts += [f"{name}: Optional[_type_{name}] = None" for name in optional]
    signature = ", ".join(parts)
    collected = ", ".join(f'"{name}": {name}' for name in properties) or ""

    source = "\n".join(
        [
            f"def {tool['name']}({signature}) -> {'str' if as_json else 'dict'}:",
            f"    return _run(_client, _name, {{{collected}}}, _as_json)",
        ]
    )
    # `dont_inherit=True` matters: this module uses `from __future__ import
    # annotations`, and without it the generated function's annotations would be
    # strings, which the frameworks that call `get_type_hints` cannot resolve.
    code = compile(source, f"<linkedin_toolkit:{tool['name']}>", "exec", dont_inherit=True)
    exec(code, namespace)  # noqa: S102 — the source is generated from the contract
    function = namespace[tool["name"]]
    # Set separately rather than embedded in the source, so a description
    # containing quotes or backslashes can never break the generated module.
    function.__doc__ = tool_docstring(tool)
    return function
