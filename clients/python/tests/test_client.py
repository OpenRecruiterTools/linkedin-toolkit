from __future__ import annotations

import inspect
import json

import httpx
import pytest
import respx

from linkedin_toolkit import ACTION_METHODS, LinkedInToolkit, LinkedInToolkitError

from .conftest import BASE_URL, TOKEN


def envelope(data):
    return {"id": "req_1", "ok": True, "data": data}


def failure(**error):
    return {"id": "req_1", "ok": False, "error": error}


@respx.mock
def test_posts_params_to_the_action_path_with_the_bearer_token(client):
    route = respx.post(f"{BASE_URL}/actions/search.people").mock(
        return_value=httpx.Response(200, json=envelope({"profiles": [], "total": 0}))
    )
    result = client.search_people(keywords="CTO", count=10)

    assert result == {"profiles": [], "total": 0}
    request = route.calls.last.request
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert json.loads(request.read()) == {"keywords": "CTO", "count": 10}


@respx.mock
def test_sends_no_origin_header(client):
    route = respx.post(f"{BASE_URL}/actions/status.get").mock(
        return_value=httpx.Response(200, json=envelope({"connected": True}))
    )
    client.status_get()
    # Clients are agent surfaces: the server's 'mcp' default is the right origin.
    assert "x-linkedin-toolkit-origin" not in route.calls.last.request.headers


@respx.mock
def test_drops_unset_optional_params_rather_than_sending_null(client):
    route = respx.post(f"{BASE_URL}/actions/search.people").mock(
        return_value=httpx.Response(200, json=envelope({"profiles": []}))
    )
    client.search_people(keywords="CTO")
    assert json.loads(route.calls.last.request.read()) == {"keywords": "CTO"}


@respx.mock
def test_turns_an_error_envelope_into_an_exception_with_every_field(client):
    respx.post(f"{BASE_URL}/actions/outreach.invite").mock(
        return_value=httpx.Response(
            200,
            json=failure(
                code="RATE_LIMITED",
                message="Too many invites this hour.",
                howToFix="Wait for the window to reset.",
                retryAfter=900000,
            ),
        )
    )
    with pytest.raises(LinkedInToolkitError) as raised:
        client.outreach_invite(publicId="someone")

    error = raised.value
    assert error.code == "RATE_LIMITED"
    assert error.message == "Too many invites this hour."
    assert error.how_to_fix == "Wait for the window to reset."
    assert error.retry_after == 900000
    assert error.action == "outreach.invite"
    assert error.terminal is True
    assert error.known is True
    assert error.to_dict()["error"] == "RATE_LIMITED"


@respx.mock
def test_invalid_params_is_not_terminal(client):
    respx.post(f"{BASE_URL}/actions/outreach.invite").mock(
        return_value=httpx.Response(200, json=failure(code="INVALID_PARAMS", message="publicId: Required"))
    )
    with pytest.raises(LinkedInToolkitError) as raised:
        client.outreach_invite(publicId="")
    assert raised.value.terminal is False


@respx.mock
def test_a_queued_write_is_returned_as_success(client):
    respx.post(f"{BASE_URL}/actions/outreach.message").mock(
        return_value=httpx.Response(200, json=envelope({"status": "queued", "queueId": "q_1"}))
    )
    assert client.outreach_message(publicId="someone", body="hello") == {
        "status": "queued",
        "queueId": "q_1",
    }


@respx.mock
def test_dry_run_is_passed_through_for_write_actions(client):
    route = respx.post(f"{BASE_URL}/actions/outreach.invite").mock(
        return_value=httpx.Response(200, json=envelope({"status": "dryRun"}))
    )
    client.outreach_invite(publicId="someone", note="hi", dry_run=True)
    assert json.loads(route.calls.last.request.read()) == {
        "publicId": "someone",
        "note": "hi",
        "dry_run": True,
    }


@respx.mock
def test_unreachable_server_is_reported_as_extension_offline(client):
    respx.post(f"{BASE_URL}/actions/status.get").mock(side_effect=httpx.ConnectError("refused"))
    with pytest.raises(LinkedInToolkitError) as raised:
        client.status_get()
    assert raised.value.code == "EXTENSION_OFFLINE"
    assert "lit serve --http" in raised.value.how_to_fix


@respx.mock
def test_a_timeout_is_reported_as_internal(client):
    respx.post(f"{BASE_URL}/actions/status.get").mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(LinkedInToolkitError) as raised:
        client.status_get()
    assert raised.value.code == "INTERNAL"
    assert "timed out" in raised.value.message


@respx.mock
def test_a_non_json_body_is_reported_rather_than_leaking_a_parse_error(client):
    respx.post(f"{BASE_URL}/actions/status.get").mock(
        return_value=httpx.Response(502, text="<html>nope</html>")
    )
    with pytest.raises(LinkedInToolkitError) as raised:
        client.status_get()
    assert raised.value.code == "INTERNAL"
    assert "502" in raised.value.message


@respx.mock
def test_an_unrecognised_body_is_reported(client):
    respx.post(f"{BASE_URL}/actions/status.get").mock(return_value=httpx.Response(200, json={"hi": 1}))
    with pytest.raises(LinkedInToolkitError) as raised:
        client.status_get()
    assert raised.value.code == "INTERNAL"


@respx.mock
def test_call_tool_uses_the_tools_path(client):
    route = respx.post(f"{BASE_URL}/tools/linkedin_query_sql").mock(
        return_value=httpx.Response(200, json=envelope({"rowCount": 1}))
    )
    assert client.call_tool("linkedin_query_sql", {"sql": "SELECT 1"}) == {"rowCount": 1}
    assert route.called


@respx.mock
def test_health_needs_no_token(client):
    route = respx.get(f"{BASE_URL}/health").mock(
        return_value=httpx.Response(200, json={"ok": True, "extensionConnected": False, "version": "2.0.0"})
    )
    assert client.health()["ok"] is True
    assert "authorization" not in route.calls.last.request.headers


#: A value of the right shape for each annotation the generated methods use.
_SAMPLES = {"str": "x", "int": 1, "float": 1.0, "bool": True}


def _sample_arguments(function):
    """Minimal valid keyword arguments for a generated method."""
    arguments = {}
    for name, parameter in inspect.signature(function).parameters.items():
        if parameter.default is not inspect.Parameter.empty:
            continue
        annotation = parameter.annotation
        origin = getattr(annotation, "__origin__", None)
        if origin is list:
            arguments[name] = []
        elif origin is dict or annotation is dict:
            arguments[name] = {}
        else:
            arguments[name] = _SAMPLES.get(getattr(annotation, "__name__", ""), "x")
    return arguments


@respx.mock
def test_every_action_has_a_method_that_hits_its_own_path(client):
    for action, method in ACTION_METHODS.items():
        route = respx.post(f"{BASE_URL}/actions/{action}").mock(
            return_value=httpx.Response(200, json=envelope({}))
        )
        function = getattr(client, method)
        function(**_sample_arguments(function))
        assert route.called, action
        respx.reset()


def test_the_method_names_are_the_documented_ones():
    assert ACTION_METHODS["search.people"] == "search_people"
    assert ACTION_METHODS["network.unfollowCount"] == "network_unfollow_count"
    assert ACTION_METHODS["list.getAll"] == "list_get_all"
    assert ACTION_METHODS["export.csv"] == "export_csv"


def test_the_client_can_be_used_as_a_context_manager():
    with LinkedInToolkit(base_url=BASE_URL, token=TOKEN) as instance:
        assert instance.base_url == BASE_URL


def test_the_research_pack_tool_gets_a_wider_timeout_than_the_default(client):
    """The server blocks on this tool for up to 10 minutes; 120 s would abandon a good run."""
    assert client._timeout_for("linkedin_research_pack") == 660.0
    assert client._timeout_for("linkedin_sync") == client.timeout


def test_a_deliberately_raised_timeout_is_never_lowered():
    generous = LinkedInToolkit(base_url=BASE_URL, token=TOKEN, timeout=900.0)
    assert generous._timeout_for("linkedin_research_pack") == 900.0


@respx.mock
def test_the_research_pack_timeout_reaches_httpx(client):
    route = respx.post(f"{BASE_URL}/tools/linkedin_research_pack").mock(
        return_value=httpx.Response(200, json=envelope({"jobId": "j_1"}))
    )
    assert client.call_tool("linkedin_research_pack", {"rows": []}) == {"jobId": "j_1"}
    assert route.called
    assert route.calls.last.request.extensions["timeout"]["read"] == 660.0
