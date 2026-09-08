"""linkedin-toolkit — the Python client for the LinkedIn Toolkit local HTTP API.

    from linkedin_toolkit import LinkedInToolkit

    client = LinkedInToolkit()
    status = client.status_get()
    data = client.search_people(keywords="CTO fintech London", count=25)

Nothing leaves your machine except the LinkedIn calls your own Chrome makes.
Hard caps (100 invites, 150 messages, 500 visits, 1,000 search results per day)
live in the browser extension and cannot be raised from here. Writes return
``{"status": "queued"}`` while Copilot mode is on — a human approves them in the
extension popup, and that is success.

Framework wrappers live in ``linkedin_toolkit.integrations``; each one imports
its framework lazily and names the extra to install if it is missing.
"""

from __future__ import annotations

from ._actions import ACTION_METHODS
from ._config import DEFAULT_BASE_URL, ResolvedConfig, resolve_config, toolkit_home
from .client import AsyncLinkedInToolkit, LinkedInToolkit
from .errors import ERROR_CODES, TERMINAL_ERROR_CODES, LinkedInToolkitError
from .tools import raw_tools, tool_by_name, tools, tools_version

__version__ = "2.0.0"

__all__ = [
    "__version__",
    "LinkedInToolkit",
    "AsyncLinkedInToolkit",
    "LinkedInToolkitError",
    "ERROR_CODES",
    "TERMINAL_ERROR_CODES",
    "DEFAULT_BASE_URL",
    "ResolvedConfig",
    "resolve_config",
    "toolkit_home",
    "tools",
    "raw_tools",
    "tool_by_name",
    "tools_version",
    "ACTION_METHODS",
    "models",
]

from . import models  # noqa: E402  (re-exported for `from linkedin_toolkit import models`)
