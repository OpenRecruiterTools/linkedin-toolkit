"""End to end against the real server in demo mode: ``lit serve --http --fake``.

Not a mock. ``--fake`` attaches an in-process demo extension over the real
WebSocket bridge, so a call here travels the same path a real one does — HTTP
router, param validation, bridge frame, engine, envelope back. What it cannot do
is touch LinkedIn: the data is invented and nothing leaves the machine.

Skipped, not failed, when Node or ``mcp-server/dist`` is unavailable: this
package must be testable on its own, and the Python CI job has no Node.
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import time
from pathlib import Path

import httpx
import pytest

import linkedin_toolkit
from linkedin_toolkit import AsyncLinkedInToolkit, LinkedInToolkit, LinkedInToolkitError

REPO_ROOT = Path(linkedin_toolkit.__file__).resolve().parent.parent.parent.parent
CLI = REPO_ROOT / "mcp-server" / "dist" / "cli.js"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(
    NODE is None or not CLI.exists(),
    reason="needs Node and a built mcp-server (npm run build -w mcp-server)",
)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def fake_server(tmp_path_factory):
    home = tmp_path_factory.mktemp("toolkit-home")
    http_port, bridge_port = free_port(), free_port()

    process = subprocess.Popen(
        [
            NODE,
            str(CLI),
            "serve",
            "--http",
            "--fake",
            "--port",
            str(http_port),
            "--bridge-port",
            str(bridge_port),
        ],
        env={**__import__("os").environ, "LINKEDIN_TOOLKIT_HOME": str(home)},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    base_url = f"http://127.0.0.1:{http_port}"
    deadline = time.time() + 30
    while True:
        try:
            health = httpx.get(f"{base_url}/health", timeout=2).json()
            if health.get("extensionConnected"):
                break
        except Exception:  # noqa: BLE001 — the server simply is not up yet
            pass
        if time.time() > deadline:
            process.kill()
            pytest.fail("The fake server never became ready.")
        time.sleep(0.2)

    token = json.loads((home / "config.json").read_text(encoding="utf-8"))["token"]
    try:
        yield base_url, token
    finally:
        process.kill()
        process.wait(timeout=10)


@pytest.fixture()
def live(fake_server):
    base_url, token = fake_server
    with LinkedInToolkit(base_url=base_url, token=token) as client:
        yield client


def test_health_with_the_demo_extension_attached(live):
    health = live.health()
    assert health["ok"] is True
    assert health["extensionConnected"] is True


def test_status_is_contract_shaped(live):
    status = live.status_get()
    assert status["connected"] is True
    assert status["quotas"]["invite"]["dailyCap"] > 0
    linkedin_toolkit.models.Status.model_validate(status)


def test_search_returns_profiles_the_models_accept(live):
    result = live.search_people(keywords="platform engineering", count=5)
    assert result["profiles"]
    for raw in result["profiles"]:
        profile = linkedin_toolkit.models.Profile.model_validate(raw)
        assert "linkedin.com" in profile.url


def test_an_invite_queues_rather_than_sends(live):
    target = live.search_people(keywords="platform engineering", count=1)["profiles"][0]["publicId"]
    result = live.outreach_invite(publicId=target, note="Enjoyed your talk.")

    assert result["status"] == "queued"
    assert result["queueId"]
    queued = live.queue_list(status="pending")["items"]
    assert any(item["id"] == result["queueId"] for item in queued)


def test_dry_run_previews_without_queueing(live):
    before = len(live.queue_list(status="pending")["items"])
    result = live.outreach_invite(publicId="anyone", dry_run=True)
    assert result["status"] == "dryRun"
    assert len(live.queue_list(status="pending")["items"]) == before


def test_the_server_local_tools_are_reachable(live):
    assert "counts" in live.call_tool("linkedin_sync")
    result = live.call_tool("linkedin_query_sql", {"sql": "SELECT COUNT(*) AS n FROM profiles"})
    assert result["rowCount"] == 1


def test_a_bad_token_is_unauthorized(fake_server):
    base_url, _ = fake_server
    with LinkedInToolkit(base_url=base_url, token="not-the-token") as client:
        with pytest.raises(LinkedInToolkitError) as raised:
            client.status_get()
    assert raised.value.code == "UNAUTHORIZED"


def test_bad_params_are_rejected_by_the_server(live):
    with pytest.raises(LinkedInToolkitError) as raised:
        live.call("search.people", {"keywords": "x", "count": 5000})
    assert raised.value.code == "INVALID_PARAMS"


async def test_the_async_client_works_against_the_same_server(fake_server):
    base_url, token = fake_server
    async with AsyncLinkedInToolkit(base_url=base_url, token=token) as client:
        status = await client.status_get()
        result = await client.search_people(keywords="platform engineering", count=3)
    assert status["connected"] is True
    assert result["profiles"]


def test_the_committed_tool_definitions_match_the_running_server(live):
    served = httpx.get(f"{live.base_url}/openapi.json", timeout=10).json()
    tool_paths = {path[len("/tools/") :] for path in served["paths"] if path.startswith("/tools/")}
    assert {tool["name"] for tool in live.tools()} == tool_paths
