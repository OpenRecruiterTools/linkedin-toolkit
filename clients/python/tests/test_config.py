from __future__ import annotations

import json

from linkedin_toolkit import DEFAULT_BASE_URL, resolve_config, toolkit_home


def write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_default_when_nothing_is_configured(tmp_path):
    resolved = resolve_config(env={"LINKEDIN_TOOLKIT_HOME": str(tmp_path)})
    assert resolved.base_url == DEFAULT_BASE_URL
    assert resolved.base_url_source == "default"
    assert resolved.token is None
    assert resolved.token_source == "none"


def test_options_win_over_everything(tmp_path):
    write(tmp_path / "config.json", {"token": "from-file", "httpPort": 5000})
    write(tmp_path / "server.json", {"httpPort": 6000})
    resolved = resolve_config(
        base_url="http://127.0.0.1:1234/",
        token="explicit",
        env={
            "LINKEDIN_TOOLKIT_HOME": str(tmp_path),
            "LINKEDIN_TOOLKIT_URL": "http://x",
            "LINKEDIN_TOOLKIT_TOKEN": "y",
        },
    )
    assert resolved.base_url == "http://127.0.0.1:1234"
    assert resolved.token == "explicit"
    assert (resolved.base_url_source, resolved.token_source) == ("option", "option")


def test_environment_wins_over_files(tmp_path):
    write(tmp_path / "config.json", {"token": "from-file"})
    write(tmp_path / "server.json", {"httpPort": 6000})
    resolved = resolve_config(
        env={
            "LINKEDIN_TOOLKIT_HOME": str(tmp_path),
            "LINKEDIN_TOOLKIT_URL": "http://127.0.0.1:9999",
            "LINKEDIN_TOOLKIT_TOKEN": "from-env",
        }
    )
    assert resolved.base_url == "http://127.0.0.1:9999"
    assert resolved.token == "from-env"
    assert (resolved.base_url_source, resolved.token_source) == ("env", "env")


def test_running_server_port_beats_the_configured_one(tmp_path):
    write(tmp_path / "config.json", {"token": "tok", "httpPort": 47830})
    write(tmp_path / "server.json", {"httpPort": 9000, "bridgePort": 9001})
    resolved = resolve_config(env={"LINKEDIN_TOOLKIT_HOME": str(tmp_path)})
    assert resolved.base_url == "http://127.0.0.1:9000"
    assert resolved.base_url_source == "server.json"
    assert resolved.token == "tok"
    assert resolved.token_source == "config.json"


def test_configured_port_when_no_server_is_running(tmp_path):
    write(tmp_path / "config.json", {"token": "tok", "httpPort": 47999})
    resolved = resolve_config(env={"LINKEDIN_TOOLKIT_HOME": str(tmp_path)})
    assert resolved.base_url == "http://127.0.0.1:47999"
    assert resolved.base_url_source == "config.json"


def test_a_corrupt_file_is_ignored_rather_than_raising(tmp_path):
    (tmp_path / "config.json").write_text("{ not json", encoding="utf-8")
    (tmp_path / "server.json").write_text("also not json", encoding="utf-8")
    resolved = resolve_config(env={"LINKEDIN_TOOLKIT_HOME": str(tmp_path)})
    assert resolved.base_url == DEFAULT_BASE_URL
    assert resolved.token is None


def test_a_nonsense_port_is_ignored(tmp_path):
    write(tmp_path / "server.json", {"httpPort": "9000"})
    write(tmp_path / "config.json", {"token": "tok", "httpPort": 99999})
    resolved = resolve_config(env={"LINKEDIN_TOOLKIT_HOME": str(tmp_path)})
    assert resolved.base_url == DEFAULT_BASE_URL


def test_home_follows_the_environment(tmp_path):
    assert toolkit_home({"LINKEDIN_TOOLKIT_HOME": str(tmp_path)}) == tmp_path
    assert toolkit_home({}).name == ".linkedin-toolkit"
