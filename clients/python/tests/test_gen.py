"""The guard that keeps this package honest.

The committed generated files must be exactly what ``scripts/gen.py`` produces
from the MCP server's contract right now.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

import linkedin_toolkit
from linkedin_toolkit import ACTION_METHODS, raw_tools

PACKAGE_ROOT = Path(linkedin_toolkit.__file__).resolve().parent
REPO_ROOT = PACKAGE_ROOT.parent.parent.parent
MCP_TOOLS = REPO_ROOT / "mcp-server" / "tools.json"


def load_generator():
    path = PACKAGE_ROOT.parent / "scripts" / "gen.py"
    spec = importlib.util.spec_from_file_location("linkedin_toolkit_gen", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["linkedin_toolkit_gen"] = module
    spec.loader.exec_module(module)
    return module


needs_repo = pytest.mark.skipif(
    not MCP_TOOLS.exists(), reason="mcp-server/tools.json is not present (installed package)"
)


@needs_repo
def test_the_committed_files_are_what_gen_produces(tmp_path):
    generator = load_generator()
    generator.generate(tmp_path)

    for name in ("tools.json", "_actions.py"):
        expected = (tmp_path / name).read_text(encoding="utf-8")
        actual = (PACKAGE_ROOT / name).read_text(encoding="utf-8")
        assert actual == expected, f"{name} is stale — run `python scripts/gen.py` in clients/python"


@needs_repo
def test_tools_json_is_byte_identical_to_the_servers():
    assert (PACKAGE_ROOT / "tools.json").read_bytes() == MCP_TOOLS.read_bytes()


@needs_repo
def test_every_tool_the_server_declares_is_present():
    served = json.loads(MCP_TOOLS.read_text(encoding="utf-8"))["tools"]
    assert [tool["name"] for tool in raw_tools()] == [tool["name"] for tool in served]


@needs_repo
def test_every_action_the_server_serves_has_a_method():
    openapi = json.loads((REPO_ROOT / "mcp-server" / "openapi.json").read_text(encoding="utf-8"))
    actions = sorted(
        path[len("/actions/") :] for path in openapi["paths"] if path.startswith("/actions/")
    )
    assert sorted(ACTION_METHODS) == actions


def test_method_naming_rules():
    generator_names = {
        "search.people": "search_people",
        "status.get": "status_get",
        "list.getAll": "list_get_all",
        "network.unfollowCount": "network_unfollow_count",
        "export.csv": "export_csv",
    }
    for action, method in generator_names.items():
        assert ACTION_METHODS[action] == method
