from __future__ import annotations

import json

import httpx
import pytest
import respx

from linkedin_toolkit import AsyncLinkedInToolkit, LinkedInToolkitError

from .conftest import BASE_URL, TOKEN


def envelope(data):
    return {"id": "req_1", "ok": True, "data": data}


@respx.mock
async def test_the_generated_methods_are_awaitable():
    route = respx.post(f"{BASE_URL}/actions/search.people").mock(
        return_value=httpx.Response(200, json=envelope({"profiles": [{"publicId": "a"}]}))
    )
    async with AsyncLinkedInToolkit(base_url=BASE_URL, token=TOKEN) as client:
        result = await client.search_people(keywords="CTO", count=5)

    assert result == {"profiles": [{"publicId": "a"}]}
    assert json.loads(route.calls.last.request.read()) == {"keywords": "CTO", "count": 5}
    assert route.calls.last.request.headers["authorization"] == f"Bearer {TOKEN}"


@respx.mock
async def test_errors_carry_the_same_fields_as_the_sync_client():
    respx.post(f"{BASE_URL}/actions/outreach.invite").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "req_1",
                "ok": False,
                "error": {"code": "QUOTA_EXCEEDED", "message": "100 invites used today."},
            },
        )
    )
    async with AsyncLinkedInToolkit(base_url=BASE_URL, token=TOKEN) as client:
        with pytest.raises(LinkedInToolkitError) as raised:
            await client.outreach_invite(publicId="someone")

    assert raised.value.code == "QUOTA_EXCEEDED"
    assert raised.value.terminal is True


@respx.mock
async def test_call_and_call_tool_and_health():
    respx.post(f"{BASE_URL}/actions/status.get").mock(
        return_value=httpx.Response(200, json=envelope({"connected": True}))
    )
    respx.post(f"{BASE_URL}/tools/linkedin_sync").mock(
        return_value=httpx.Response(200, json=envelope({"counts": {}}))
    )
    respx.get(f"{BASE_URL}/health").mock(
        return_value=httpx.Response(200, json={"ok": True, "extensionConnected": True, "version": "2.0.0"})
    )

    async with AsyncLinkedInToolkit(base_url=BASE_URL, token=TOKEN) as client:
        assert await client.call("status.get") == {"connected": True}
        assert await client.call_tool("linkedin_sync") == {"counts": {}}
        assert (await client.health())["extensionConnected"] is True


@respx.mock
async def test_an_unreachable_server_is_extension_offline():
    respx.post(f"{BASE_URL}/actions/status.get").mock(side_effect=httpx.ConnectError("refused"))
    async with AsyncLinkedInToolkit(base_url=BASE_URL, token=TOKEN) as client:
        with pytest.raises(LinkedInToolkitError) as raised:
            await client.status_get()
    assert raised.value.code == "EXTENSION_OFFLINE"


def test_both_clients_share_the_same_generated_methods():
    from linkedin_toolkit import ACTION_METHODS, LinkedInToolkit

    for method in ACTION_METHODS.values():
        assert hasattr(LinkedInToolkit, method)
        assert hasattr(AsyncLinkedInToolkit, method)
        assert getattr(LinkedInToolkit, method) is getattr(AsyncLinkedInToolkit, method)
