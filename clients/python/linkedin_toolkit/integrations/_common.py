"""Shared plumbing for the framework wrappers.

Three jobs:

* turn a tool's JSON Schema into a pydantic model — **recursively**, so a
  nested object stays an object and an enum stays an enum, for the frameworks
  that want ``args_schema``;
* build a real Python function with a real signature and a Google-style
  docstring, for the frameworks that read ``inspect.signature`` and the
  docstring instead (AutoGen, Google ADK, LlamaIndex, Pydantic AI);
* fail with a sentence that names the extra to install, rather than a bare
  ``ModuleNotFoundError`` from three frames down.

Why recursive matters: `campaign.create` takes `steps`, an array of objects
whose `type` is one of nine values and whose `branch` nests further. Flattened
to `list[dict]` a model is told "send a list of anything", and it will — this
is the difference between an agent that writes a valid sequence first time and
one that guesses. `tests/test_integrations.py` walks every tool and asserts the
generated model's `model_json_schema()` still carries every nested property,
every required set and every enum that `tools.json` declares.

Parameter names are the contract's names, verbatim — ``publicId``, not
``public_id``. One vocabulary across MCP, HTTP, the docs and every wrapper is
worth more than idiomatic casing in one of them.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, create_model

from ..errors import LinkedInToolkitError

__all__ = [
    "missing_dependency",
    "args_model",
    "annotation_for",
    "json_type_name",
    "make_function",
    "run_tool",
    "smolagents_inputs",
    "tool_docstring",
]

_SCALARS: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "null": type(None),
}

#: Readable names for docstrings and for smolagents' fixed input vocabulary.
_JSON_TYPE_NAMES = {
    "string": "str",
    "integer": "int",
    "number": "float",
    "boolean": "bool",
    "array": "list",
    "object": "dict",
}

#: The contract terminates its one recursive type (`Step.branch.then`) with an
#: empty schema, so this is a belt-and-braces stop rather than a live limit.
_MAX_DEPTH = 12


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


def _camel(name: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in name.replace("-", "_").split("_") if part)


def json_type_name(schema: dict[str, Any]) -> str:
    """The flat name for one schema node — for docstrings and smolagents."""
    if not schema:
        return "Any"
    kind = schema.get("type")
    if isinstance(kind, list):
        kind = next((k for k in kind if k != "null"), None)
    return _JSON_TYPE_NAMES.get(kind, "Any") if isinstance(kind, str) else "Any"


def _field_description(name: str, schema: dict[str, Any]) -> str:
    parts: list[str] = []
    if schema.get("description"):
        parts.append(str(schema["description"]))
    if "enum" in schema:
        parts.append("one of " + ", ".join(json.dumps(v) for v in schema["enum"]))
    if "minimum" in schema:
        parts.append(f"minimum {schema['minimum']}")
    if "maximum" in schema:
        parts.append(f"maximum {schema['maximum']}")
    if name == "dry_run":
        parts.append("preview the write without queueing or sending it")
    return "; ".join(parts) or name


def annotation_for(schema: dict[str, Any], name_hint: str, depth: int = 0) -> Any:
    """A python annotation for one JSON Schema node, built all the way down.

    An empty schema is ``Any``: that is how the contract closes off its one
    recursive type, and it is also the honest answer for a node that says
    nothing.
    """
    if not schema or depth >= _MAX_DEPTH:
        return Any

    if "enum" in schema:
        values = list(schema["enum"])
        return Literal[tuple(values)] if values else Any  # type: ignore[misc]

    for combinator in ("anyOf", "oneOf"):
        options = schema.get(combinator)
        if isinstance(options, list) and options:
            built = tuple(
                annotation_for(option, f"{name_hint}Option{index}", depth + 1)
                for index, option in enumerate(options)
            )
            return Union[built]  # type: ignore[valid-type]

    if isinstance(schema.get("allOf"), list) and schema["allOf"]:
        return annotation_for(schema["allOf"][0], name_hint, depth + 1)

    kind = schema.get("type")
    if isinstance(kind, list):
        # A union of primitives, spelled as a type list rather than anyOf.
        # `linkedin_query_sql.params` is the contract's only one, and collapsing
        # it to `str` would tell a model it cannot bind a numeric parameter.
        members = tuple(
            annotation_for({**schema, "type": member}, f"{name_hint}Type{index}", depth + 1)
            for index, member in enumerate(kind)
        )
        return Union[members] if members else Any  # type: ignore[valid-type]

    if kind == "array":
        return list[annotation_for(schema.get("items") or {}, f"{name_hint}Item", depth + 1)]  # type: ignore[misc]

    if kind == "object":
        if schema.get("properties"):
            return _object_model(schema, name_hint, depth)
        extra = schema.get("additionalProperties")
        if isinstance(extra, dict) and extra:
            return dict[str, annotation_for(extra, f"{name_hint}Value", depth + 1)]  # type: ignore[misc]
        return dict[str, Any]

    return _SCALARS.get(kind, Any) if isinstance(kind, str) else Any


def _object_model(schema: dict[str, Any], name: str, depth: int = 0) -> type[BaseModel]:
    """One pydantic model for an object node, with its children built too."""
    properties: dict[str, Any] = schema.get("properties") or {}
    required = set(schema.get("required") or [])

    fields: dict[str, Any] = {}
    for field_name, field_schema in properties.items():
        annotation = annotation_for(field_schema, f"{name}{_camel(field_name)}", depth + 1)
        description = _field_description(field_name, field_schema)
        if field_name in required:
            fields[field_name] = (annotation, Field(description=description))
        else:
            fields[field_name] = (Optional[annotation], Field(default=None, description=description))

    # `extra="allow"` everywhere, including where the contract says
    # additionalProperties:false. A model that adds a stray key should reach the
    # server and get a real INVALID_PARAMS naming the field, rather than dying
    # inside a framework's validation with no way to tell the user why.
    return create_model(name, __config__=ConfigDict(extra="allow"), **fields)


def args_model(tool: dict[str, Any]) -> type[BaseModel]:
    """A pydantic model for a tool's arguments, for ``args_schema``-style frameworks."""
    schema: dict[str, Any] = tool.get("parameters") or {}
    model = _object_model(schema, f"{_camel(tool['name'])}Args")
    model.__doc__ = tool["description"]
    return model


def tool_docstring(tool: dict[str, Any]) -> str:
    """A Google-style docstring. Several frameworks parse the ``Args:`` block."""
    schema: dict[str, Any] = tool.get("parameters") or {}
    properties: dict[str, Any] = schema.get("properties") or {}
    required = set(schema.get("required") or [])

    lines = [tool["description"], ""]
    if properties:
        lines.append("Args:")
        for name, spec in properties.items():
            optional = "" if name in required else " Optional."
            lines.append(f"    {name} ({json_type_name(spec)}): {_field_description(name, spec)}.{optional}")
        lines.append("")
    lines.append("Returns:")
    lines.append("    str: The action's result as JSON, or an error object with code and message.")
    return "\n".join(lines)


def _plain(value: Any) -> Any:
    """Unwrap anything a framework may have validated into a model for us.

    Pydantic AI and CrewAI can hand back model instances rather than the dicts
    the wire wants, now that the argument models are nested.
    """
    if isinstance(value, BaseModel):
        return value.model_dump(exclude_none=True, by_alias=True)
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    return value


def run_tool(client: Any, name: str, arguments: dict[str, Any], as_json: bool = True) -> Any:
    """Call a tool and shape the failure the way agent frameworks cope with best.

    A raised exception aborts most agent loops. Returning the error as data lets
    the model read ``CHALLENGE_DETECTED`` and stop for the right reason — which
    is what every page in ``docs/agents`` tells it to do.
    """
    cleaned = {key: _plain(value) for key, value in arguments.items() if value is not None}
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
    Google ADK, LlamaIndex and Pydantic AI all build their schema from
    ``inspect.signature``, and a catch-all signature gives the model nothing.
    The annotations are the same nested types ``args_model`` builds, so those
    frameworks see the same shape the ``args_schema`` ones do.
    """
    schema: dict[str, Any] = tool.get("parameters") or {}
    properties: dict[str, Any] = schema.get("properties") or {}
    required_names = set(schema.get("required") or [])
    required = [name for name in properties if name in required_names]
    optional = [name for name in properties if name not in required_names]

    namespace: dict[str, Any] = {
        "_run": run_tool,
        "_client": client,
        "_name": tool["name"],
        "_as_json": as_json,
        "Any": Any,
        "Optional": Optional,
    }
    for name, spec in properties.items():
        namespace[f"_type_{name}"] = annotation_for(spec, f"{_camel(tool['name'])}{_camel(name)}")

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


# --------------------------------------------------------------------------- #
# smolagents
# --------------------------------------------------------------------------- #

#: smolagents accepts a fixed vocabulary of input types, so it is the one
#: wrapper that cannot carry the nested shape in its schema. The nesting goes
#: into the description instead, which is all a `CodeAgent` needs to build the
#: dict correctly. Lives here rather than in `smolagents.py` so it is testable
#: without the framework installed.
_SMOLAGENTS_TYPES = {
    "str": "string",
    "int": "integer",
    "float": "number",
    "bool": "boolean",
    "list": "array",
    "dict": "object",
}


def _describe_shape(name: str, spec: dict[str, Any]) -> str:
    description = spec.get("description") or name
    if "enum" in spec:
        description = f"{description} — one of {', '.join(map(str, spec['enum']))}"
    item_properties = ((spec.get("items") or {}).get("properties")) or {}
    if item_properties:
        description = f"{description} — each item has {', '.join(item_properties)}"
    elif spec.get("properties"):
        description = f"{description} — keys: {', '.join(spec['properties'])}"
    return description


def smolagents_inputs(tool: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The `inputs` dict a smolagents `Tool` subclass declares."""
    schema: dict[str, Any] = tool.get("parameters") or {}
    properties: dict[str, Any] = schema.get("properties") or {}
    required = set(schema.get("required") or [])

    return {
        name: {
            "type": _SMOLAGENTS_TYPES.get(json_type_name(spec), "any"),
            "description": _describe_shape(name, spec),
            "nullable": name not in required,
        }
        for name, spec in properties.items()
    }
