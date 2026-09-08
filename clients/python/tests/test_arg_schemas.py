"""The argument models must keep the whole shape of the contract, not a flat cast of it.

A model told ``steps: list[dict]`` will send a list of anything. A model told
``steps`` is an array of objects whose ``type`` is one of nine values, one of
which nests a ``branch``, writes a valid sequence first time. This file walks
every tool and asserts the generated ``model_json_schema()`` is structurally
what ``tools.json`` declares — same properties at every level, same required
sets, same enums.

"Structurally", not "identically": pydantic adds ``title`` and ``default``,
routes nested models through ``$defs``, and spells ``Optional[X]`` as
``anyOf: [X, {"type": "null"}]``. The walk below resolves all three.
``additionalProperties`` is deliberately not compared — see the note in
``_common._object_model``.
"""

from __future__ import annotations

from typing import Any

import pytest

from linkedin_toolkit import tool_by_name, tools
from linkedin_toolkit.integrations import _common


def resolve(node: dict[str, Any], defs: dict[str, Any]) -> dict[str, Any]:
    """Follow pydantic's `$defs` reference, and unwrap `Optional[X]`."""
    seen = 0
    while isinstance(node, dict) and "$ref" in node and seen < 16:
        node = defs[node["$ref"].rsplit("/", 1)[-1]]
        seen += 1
    if isinstance(node, dict) and isinstance(node.get("anyOf"), list):
        options = [option for option in node["anyOf"] if option.get("type") != "null"]
        if len(options) == 1:
            return resolve(options[0], defs)
    return node


def assert_equivalent(expected: dict[str, Any], actual: dict[str, Any], defs: dict[str, Any], path: str) -> None:
    actual = resolve(actual, defs)

    if not expected:
        # `{}` is how the contract closes off its one recursive type. Anything
        # the model says here is fine.
        return

    if "enum" in expected:
        got = actual.get("enum")
        if got is None and "const" in actual:
            got = [actual["const"]]
        assert got is not None, f"{path}: the enum was flattened away"
        assert sorted(got) == sorted(expected["enum"]), path
        return

    kind = expected.get("type")

    if isinstance(kind, list):
        # A union spelled as a type list. Pydantic spells the same thing as anyOf.
        options = actual.get("anyOf") or [actual]
        assert {option.get("type") for option in options} == set(kind), path
        return

    if kind == "array":
        assert actual.get("type") == "array", path
        assert_equivalent(expected.get("items") or {}, actual.get("items") or {}, defs, f"{path}[]")
        return

    if kind == "object":
        properties = expected.get("properties")
        if properties:
            actual_properties = actual.get("properties") or {}
            assert set(actual_properties) == set(properties), path
            assert set(actual.get("required") or []) == set(expected.get("required") or []), path
            for name, spec in properties.items():
                assert_equivalent(spec, actual_properties[name], defs, f"{path}.{name}")
            return

        extra = expected.get("additionalProperties")
        if isinstance(extra, dict) and extra:
            assert_equivalent(extra, actual.get("additionalProperties") or {}, defs, f"{path}.*")
            return

        assert actual.get("type") == "object", path
        return

    assert actual.get("type") == kind, f"{path}: expected {kind}, got {actual.get('type')}"


@pytest.mark.parametrize("tool", tools(), ids=lambda tool: tool["name"])
def test_every_tool_keeps_its_whole_shape(tool):
    schema = _common.args_model(tool).model_json_schema()
    assert_equivalent(tool["parameters"], schema, schema.get("$defs", {}), tool["name"])


def test_campaign_steps_keep_their_nested_objects_and_enums():
    """The worst case in the contract: an array of objects with an enum and a nested branch."""
    schema = _common.args_model(tool_by_name("linkedin_campaign_create")).model_json_schema()
    defs = schema["$defs"]

    step = resolve(schema["properties"]["steps"], defs)["items"]
    step = resolve(step, defs)
    assert set(step["properties"]) == {
        "type",
        "note",
        "body",
        "subject",
        "variants",
        "waitMs",
        "branch",
    }
    assert step["required"] == ["type"]
    assert step["properties"]["type"]["enum"] == [
        "view",
        "follow",
        "invite",
        "message",
        "inmail",
        "like",
        "comment",
        "wait",
        "branch",
    ]

    branch = resolve(step["properties"]["branch"], defs)
    assert set(branch["properties"]) == {"on", "ms", "then", "else"}
    assert set(branch["required"]) == {"on", "then", "else"}
    assert branch["properties"]["on"]["enum"] == ["accepted", "replied", "notAcceptedAfterMs"]


def test_search_source_stays_an_enum_rather_than_a_bare_string():
    schema = _common.args_model(tool_by_name("linkedin_search_people")).model_json_schema()
    source = resolve(schema["properties"]["source"], schema.get("$defs", {}))
    assert source["enum"] == ["search", "salesnav", "recruiter"]
    assert resolve(schema["properties"]["count"], {}).get("type") == "integer"


def test_queue_edits_stays_a_map_of_objects():
    """`edits` is a record keyed by queue id, which a flat cast turns into `dict`."""
    schema = _common.args_model(tool_by_name("linkedin_queue_approve")).model_json_schema()
    defs = schema["$defs"]
    edits = resolve(schema["properties"]["edits"], defs)
    assert edits["type"] == "object"
    value = resolve(edits["additionalProperties"], defs)
    assert set(value["properties"]) == {"note", "body"}


def test_list_add_profiles_keep_the_full_profile_shape():
    schema = _common.args_model(tool_by_name("linkedin_list_add")).model_json_schema()
    defs = schema["$defs"]
    profile = resolve(resolve(schema["properties"]["profiles"], defs)["items"], defs)
    assert {"publicId", "url", "fullName", "experience", "education"} <= set(profile["properties"])
    assert set(profile["required"]) == {
        "publicId",
        "url",
        "firstName",
        "lastName",
        "fullName",
        "capturedAt",
    }


def test_a_union_typed_parameter_keeps_every_member():
    """`linkedin_query_sql.params` binds strings, numbers and nulls."""
    schema = _common.args_model(tool_by_name("linkedin_query_sql")).model_json_schema()
    params = resolve(schema["properties"]["params"], schema.get("$defs", {}))
    assert {option.get("type") for option in params["items"]["anyOf"]} == {"string", "number", "null"}


def test_research_rows_keep_their_properties():
    schema = _common.args_model(tool_by_name("linkedin_research_pack")).model_json_schema()
    defs = schema["$defs"]
    row = resolve(resolve(schema["properties"]["rows"], defs)["items"], defs)
    assert set(row["properties"]) == {"name", "linkedinUrl", "email", "domain", "company"}


def test_a_model_validates_a_real_campaign_and_rejects_a_bad_step_type():
    model = _common.args_model(tool_by_name("linkedin_campaign_create"))
    parsed = model(
        name="Q3 outbound",
        steps=[
            {"type": "invite", "note": "Hello."},
            {"type": "wait", "waitMs": 86_400_000},
            {"type": "branch", "branch": {"on": "accepted", "then": [], "else": []}},
        ],
    )
    assert parsed.steps[0].type == "invite"
    assert parsed.steps[2].branch.on == "accepted"

    with pytest.raises(Exception):
        model(name="x", steps=[{"type": "teleport"}])


def test_function_signatures_carry_the_same_nested_types(client):
    """The signature-reading frameworks must see what the args_schema ones see."""
    import typing

    function = _common.make_function(client, tool_by_name("linkedin_campaign_create"))
    hints = typing.get_type_hints(function)

    steps = hints["steps"]
    assert typing.get_origin(steps) is list
    item = typing.get_args(steps)[0]
    assert set(item.model_fields) == {"type", "note", "body", "subject", "variants", "waitMs", "branch"}


def test_smolagents_inputs_describe_the_nesting_they_cannot_type():
    """smolagents takes a fixed type vocabulary, so the shape goes in the prose."""
    inputs = _common.smolagents_inputs(tool_by_name("linkedin_campaign_create"))
    assert inputs["steps"]["type"] == "array"
    assert "each item has type, note" in inputs["steps"]["description"]
    assert inputs["settings"]["description"].endswith("keys: stopOnReply, autopilot")
    assert inputs["name"]["nullable"] is False
    assert inputs["listId"]["nullable"] is True

    source = _common.smolagents_inputs(tool_by_name("linkedin_search_people"))["source"]
    assert "one of search, salesnav, recruiter" in source["description"]
