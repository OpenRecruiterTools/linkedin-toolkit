from __future__ import annotations

import pytest

from linkedin_toolkit import raw_tools, tool_by_name, tools, tools_version


def test_thirty_nine_tools_with_json_schema_parameters():
    definitions = tools()
    assert len(definitions) == 39
    for tool in definitions:
        assert tool["name"].startswith("linkedin_")
        assert len(tool["description"]) > 40
        assert tool["parameters"]["type"] == "object"


def test_version_matches_the_package():
    assert tools_version() == "2.0.0"


def test_read_only_drops_every_write_tool():
    names = [tool["name"] for tool in tools(read_only=True)]
    assert "linkedin_search_people" in names
    assert "linkedin_send_invite" not in names
    assert "linkedin_send_message" not in names
    assert all(not tool["write"] for tool in tools(read_only=True))


def test_include_and_exclude():
    assert [t["name"] for t in tools(include=["linkedin_get_status"])] == ["linkedin_get_status"]
    assert "linkedin_get_status" not in [t["name"] for t in tools(exclude=["linkedin_get_status"])]


def test_dry_run_is_on_write_tools_only():
    invite = tool_by_name("linkedin_send_invite")
    status = tool_by_name("linkedin_get_status")
    assert "dry_run" in invite["parameters"]["properties"]
    assert "dry_run" not in status["parameters"]["properties"]


def test_an_unknown_tool_raises():
    with pytest.raises(KeyError):
        tool_by_name("linkedin_not_a_tool")


def test_raw_tools_keeps_the_server_field_names():
    first = raw_tools()[0]
    assert set(first) == {"name", "action", "description", "write", "inputSchema"}


def test_callers_cannot_poison_the_cached_document():
    tools()[0]["parameters"]["type"] = "poisoned"
    assert tools()[0]["parameters"]["type"] == "object"
