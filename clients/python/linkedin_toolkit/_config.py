"""Where the client gets its URL and token from.

In order:

1. what the caller passed to the constructor
2. ``LINKEDIN_TOOLKIT_URL`` / ``LINKEDIN_TOOLKIT_TOKEN``
3. ``~/.linkedin-toolkit/server.json`` — the port a running ``lit serve`` bound,
   which is the only source that knows about ``lit serve --http --port 9000``
4. ``~/.linkedin-toolkit/config.json`` — the pairing token, and the configured port
5. ``http://127.0.0.1:47830``

``LINKEDIN_TOOLKIT_HOME`` moves the directory, exactly as it does for the
server. Nothing here raises: a missing or unreadable file simply does not
contribute.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Optional

__all__ = ["DEFAULT_BASE_URL", "ResolvedConfig", "mask_token", "resolve_config", "toolkit_home"]

DEFAULT_BASE_URL = "http://127.0.0.1:47830"


def mask_token(token: Optional[str]) -> str:
    """``****a1b2``. The pairing token drives the whole toolkit, and a repr ends
    up in tracebacks, notebooks and bug reports — the last four characters are
    enough to tell two tokens apart and not enough to use one."""
    if not token:
        return "None"
    return f"****{token[-4:]}" if len(token) > 4 else "****"


@dataclass(frozen=True)
class ResolvedConfig:
    base_url: str
    token: Optional[str]
    #: Which of the five sources supplied the URL, for diagnostics.
    base_url_source: str
    token_source: str

    def __repr__(self) -> str:
        return (
            f"ResolvedConfig(base_url={self.base_url!r}, token={mask_token(self.token)}, "
            f"base_url_source={self.base_url_source!r}, token_source={self.token_source!r})"
        )


def toolkit_home(env: Optional[Mapping[str, str]] = None) -> Path:
    environ = os.environ if env is None else env
    override = environ.get("LINKEDIN_TOOLKIT_HOME")
    return Path(override) if override else Path.home() / ".linkedin-toolkit"


def _read_json(path: Path) -> Optional[dict[str, Any]]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _port(value: Any) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 0 < value < 65536 else None


def normalise_base_url(url: str) -> str:
    """Trailing slashes are tolerated, the same way ``lit`` tolerates them."""
    return url.rstrip("/")


def resolve_config(
    base_url: Optional[str] = None,
    token: Optional[str] = None,
    env: Optional[Mapping[str, str]] = None,
) -> ResolvedConfig:
    environ = os.environ if env is None else env
    home = toolkit_home(environ)
    runtime = _read_json(home / "server.json")
    config = _read_json(home / "config.json")

    runtime_port = _port(runtime.get("httpPort")) if runtime else None
    config_port = _port(config.get("httpPort")) if config else None

    if base_url:
        url, url_source = base_url, "option"
    elif environ.get("LINKEDIN_TOOLKIT_URL"):
        url, url_source = environ["LINKEDIN_TOOLKIT_URL"], "env"
    elif runtime_port is not None:
        url, url_source = f"http://127.0.0.1:{runtime_port}", "server.json"
    elif config_port is not None:
        url, url_source = f"http://127.0.0.1:{config_port}", "config.json"
    else:
        url, url_source = DEFAULT_BASE_URL, "default"

    if token:
        resolved_token, token_source = token, "option"
    elif environ.get("LINKEDIN_TOOLKIT_TOKEN"):
        resolved_token, token_source = environ["LINKEDIN_TOOLKIT_TOKEN"], "env"
    elif config and isinstance(config.get("token"), str) and config["token"]:
        resolved_token, token_source = config["token"], "config.json"
    else:
        resolved_token, token_source = None, "none"

    return ResolvedConfig(
        base_url=normalise_base_url(url),
        token=resolved_token,
        base_url_source=url_source,
        token_source=token_source,
    )
