"""Keep every test off the developer's real `~/.linkedin-toolkit`.

Without this a machine with a paired server would make the config-resolution
tests pass for the wrong reason, and a bug could write to a real config file.
"""

from __future__ import annotations

import pytest

from linkedin_toolkit import LinkedInToolkit

BASE_URL = "http://127.0.0.1:47830"
TOKEN = "test-token"


@pytest.fixture(autouse=True)
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("LINKEDIN_TOOLKIT_HOME", str(tmp_path / "toolkit-home"))
    monkeypatch.delenv("LINKEDIN_TOOLKIT_URL", raising=False)
    monkeypatch.delenv("LINKEDIN_TOOLKIT_TOKEN", raising=False)
    return tmp_path


@pytest.fixture()
def client():
    with LinkedInToolkit(base_url=BASE_URL, token=TOKEN) as instance:
        yield instance
