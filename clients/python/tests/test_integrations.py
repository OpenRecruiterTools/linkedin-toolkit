"""The framework wrappers.

Only ``langchain-core`` is installed for the test run — it is small and pure
Python. The other six are checked for the thing that actually matters when they
are absent: that the import fails with a sentence naming the extra to install,
rather than a ``ModuleNotFoundError`` from three frames down. The shared
machinery that builds their tools (schemas, signatures, docstrings, error
shaping) is exercised directly, so a bug in it is caught without installing
seven agent frameworks.
"""

from __future__ import annotations

import importlib
import inspect
import json
import typing

import httpx
import pytest
import respx

from linkedin_toolkit import LinkedInToolkit, tool_by_name, tools
from linkedin_toolkit.integrations import _common

from .conftest import BASE_URL, TOKEN

FRAMEWORKS = [
    ("llama_index", "llama-index-core", "llamaindex"),
    ("crewai", "crewai", "crewai"),
    ("google_adk", "google-adk", "google-adk"),
    ("pydantic_ai", "pydantic-ai", "pydantic-ai"),
    ("smolagents", "smolagents", "smolagents"),
]


def installed(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


@pytest.mark.parametrize("module,framework,extra", FRAMEWORKS)
def test_a_missing_framework_names_the_extra(module, framework, extra):
    target = {
        "llama_index": "llama_index.core",
        "crewai": "crewai",
        "google_adk": "google.adk",
        "pydantic_ai": "pydantic_ai",
        "smolagents": "smolagents",
    }[module]
    if installed(target.split(".")[0]):
        pytest.skip(f"{framework} is installed here, so the missing-dependency path cannot run")

    with pytest.raises(ImportError) as raised:
        importlib.import_module(f"linkedin_toolkit.integrations.{module}")

    message = str(raised.value)
    assert framework in message
    assert f'pip install "linkedin-toolkit[{extra}]"' in message


# --------------------------------------------------------------------------- #
# The shared machinery every wrapper is built from
# --------------------------------------------------------------------------- #


def test_args_model_mirrors_the_tool_schema():
    model = _common.args_model(tool_by_name("linkedin_search_people"))
    schema = model.model_json_schema()
    assert set(schema["required"]) == {"keywords"}
    assert schema["properties"]["count"]["description"].startswith("minimum 1")
    assert model(keywords="CTO").count is None


def test_args_model_covers_every_tool():
    for tool in tools():
        model = _common.args_model(tool)
        assert model.model_json_schema()["type"] == "object"


def test_make_function_has_a_real_signature_and_resolvable_hints():
    client = LinkedInToolkit(base_url=BASE_URL, token=TOKEN)
    function = _common.make_function(client, tool_by_name("linkedin_send_invite"))

    signature = inspect.signature(function)
    assert list(signature.parameters) == ["publicId", "note", "dry_run"]
    assert signature.parameters["publicId"].default is inspect.Parameter.empty
    assert signature.parameters["note"].default is None
    # Frameworks that call get_type_hints must not see stringified annotations.
    assert typing.get_type_hints(function)["publicId"] is str


def test_make_function_docstring_carries_the_args_block():
    function = _common.make_function(
        LinkedInToolkit(base_url=BASE_URL, token=TOKEN), tool_by_name("linkedin_search_people")
    )
    assert "Args:" in function.__doc__
    assert "keywords (str)" in function.__doc__
    assert "maximum 100" in function.__doc__


def test_make_function_covers_every_tool():
    client = LinkedInToolkit(base_url=BASE_URL, token=TOKEN)
    for tool in tools():
        function = _common.make_function(client, tool)
        assert function.__name__ == tool["name"]
        inspect.signature(function)


@respx.mock
def test_run_tool_returns_json_and_calls_the_tools_path():
    route = respx.post(f"{BASE_URL}/tools/linkedin_search_people").mock(
        return_value=httpx.Response(200, json={"id": "1", "ok": True, "data": {"profiles": []}})
    )
    client = LinkedInToolkit(base_url=BASE_URL, token=TOKEN)
    output = _common.run_tool(client, "linkedin_search_people", {"keywords": "CTO", "title": None})

    assert json.loads(output) == {"profiles": []}
    assert json.loads(route.calls.last.request.read()) == {"keywords": "CTO"}


@respx.mock
def test_run_tool_hands_an_error_back_as_data_rather_than_raising():
    """An exception aborts most agent loops; the model needs to read the code and stop."""
    respx.post(f"{BASE_URL}/tools/linkedin_send_invite").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "1",
                "ok": False,
                "error": {"code": "CHALLENGE_DETECTED", "message": "Clear it in Chrome."},
            },
        )
    )
    client = LinkedInToolkit(base_url=BASE_URL, token=TOKEN)
    output = json.loads(_common.run_tool(client, "linkedin_send_invite", {"publicId": "x"}))
    assert output["error"] == "CHALLENGE_DETECTED"
    assert output["message"] == "Clear it in Chrome."


# --------------------------------------------------------------------------- #
# LangChain, for real
# --------------------------------------------------------------------------- #

langchain_only = pytest.mark.skipif(
    not installed("langchain_core"), reason="langchain-core is not installed"
)


@langchain_only
def test_langchain_builds_a_structured_tool_per_tool():
    from linkedin_toolkit.integrations.langchain import get_tools

    client = LinkedInToolkit(base_url=BASE_URL, token=TOKEN)
    built = get_tools(client)
    assert len(built) == 39
    names = [tool.name for tool in built]
    assert "linkedin_search_people" in names

    search = next(tool for tool in built if tool.name == "linkedin_search_people")
    schema = search.args_schema.model_json_schema()
    assert schema["required"] == ["keywords"]
    assert len(search.description) > 40


@langchain_only
def test_langchain_read_only_cannot_send():
    from linkedin_toolkit.integrations.langchain import get_tools

    names = [tool.name for tool in get_tools(LinkedInToolkit(base_url=BASE_URL, token=TOKEN), read_only=True)]
    assert "linkedin_search_people" in names
    assert "linkedin_send_invite" not in names


@langchain_only
@respx.mock
def test_langchain_tool_invokes_the_server():
    from linkedin_toolkit.integrations.langchain import get_tools

    route = respx.post(f"{BASE_URL}/tools/linkedin_search_people").mock(
        return_value=httpx.Response(200, json={"id": "1", "ok": True, "data": {"profiles": [{"publicId": "a"}]}})
    )
    client = LinkedInToolkit(base_url=BASE_URL, token=TOKEN)
    tool = get_tools(client, include=["linkedin_search_people"])[0]

    output = tool.invoke({"keywords": "CTO"})
    assert json.loads(output) == {"profiles": [{"publicId": "a"}]}
    assert route.called
