"""The sync and async clients.

One HTTP call per action, no state, no retries. Retries are deliberately absent:
half of the error codes this API returns are terminal (``RATE_LIMITED``,
``QUOTA_EXCEEDED``, ``CHALLENGE_DETECTED``) and retrying them is the behaviour
that gets a LinkedIn account restricted.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

import httpx

from ._actions import ACTION_METHODS, ActionMethods
from ._config import ResolvedConfig, normalise_base_url, resolve_config
from .errors import LinkedInToolkitError
from .tools import tools as _tools
from .tools import tools_version as _tools_version

__all__ = ["LinkedInToolkit", "AsyncLinkedInToolkit", "ACTION_METHODS"]

DEFAULT_TIMEOUT = 120.0

#: ``POST /tools/linkedin_research_pack`` does not return a job id — the server
#: waits for the job to finish, up to its ``researchTimeoutMs`` (10 minutes by
#: default) before falling back to polling. A 120 s client timeout would abandon
#: a run the server is still doing perfectly well, so this one tool gets a
#: budget wider than the server's own. ``research_pack()`` (the action, not the
#: tool) returns immediately with a job id and is unaffected.
RESEARCH_PACK_TOOL = "linkedin_research_pack"
RESEARCH_PACK_TIMEOUT = 660.0


def _envelope_to_data(payload: Any, action: str, status_code: int, url: str) -> Any:
    if isinstance(payload, dict) and payload.get("ok") is True:
        return payload.get("data")
    if isinstance(payload, dict) and payload.get("ok") is False and isinstance(payload.get("error"), dict):
        raise LinkedInToolkitError.from_envelope(payload["error"], action=action)
    raise LinkedInToolkitError(
        code="INTERNAL",
        message=f"{url} returned {status_code} with an unrecognised body.",
        action=action,
    )


def _unreachable(base_url: str, action: str, cause: Exception) -> LinkedInToolkitError:
    if isinstance(cause, httpx.TimeoutException):
        return LinkedInToolkitError(
            code="INTERNAL",
            message=f"The request to {base_url} timed out.",
            how_to_fix="Raise timeout, or check the extension is still attached with health().",
            action=action,
        )
    return LinkedInToolkitError(
        code="EXTENSION_OFFLINE",
        message=f"Cannot reach the LinkedIn Toolkit server at {base_url}.",
        how_to_fix=(
            "Start it with `lit serve --http`, or set LINKEDIN_TOOLKIT_URL if it is on another port."
        ),
        action=action,
    )


class _Common:
    """Everything the two clients share that does not touch the network."""

    config: ResolvedConfig

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        env: Optional[Mapping[str, str]] = None,
    ) -> None:
        self.config = resolve_config(base_url, token, env)
        self.base_url = self.config.base_url
        self.token = self.config.token
        self.timeout = timeout

    def _timeout_for(self, tool_name: str) -> float:
        if tool_name == RESEARCH_PACK_TOOL:
            return max(self.timeout, RESEARCH_PACK_TIMEOUT)
        return self.timeout

    def _headers(self, authorised: bool = True) -> dict[str, str]:
        # No X-LinkedIn-Toolkit-Origin header: these clients are agent surfaces,
        # so the server's default of 'mcp' is the correct origin for them.
        headers = {"accept": "application/json", "content-type": "application/json"}
        if authorised and self.token:
            headers["authorization"] = f"Bearer {self.token}"
        return headers

    def _url(self, path: str) -> str:
        return f"{normalise_base_url(self.base_url)}{path}"

    def tools(
        self,
        include: Optional[list[str]] = None,
        exclude: Optional[list[str]] = None,
        read_only: bool = False,
    ) -> list[dict[str, Any]]:
        """``[{name, description, parameters, action, write}]`` for the 39 MCP tools."""
        return _tools(include=include, exclude=exclude, read_only=read_only)

    @property
    def tools_version(self) -> str:
        return _tools_version()


class LinkedInToolkit(_Common, ActionMethods):
    """Synchronous client.

        from linkedin_toolkit import LinkedInToolkit

        client = LinkedInToolkit()                 # finds the URL and token for you
        data = client.search_people(keywords="CTO fintech London", count=25)
        client.outreach_invite(publicId=data["profiles"][0]["publicId"], note="Hello.")

    Writes return ``{"status": "queued", "queueId": ...}`` while Copilot mode is
    on. That is success: a human approves them in the extension popup.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        env: Optional[Mapping[str, str]] = None,
        client: Optional[httpx.Client] = None,
    ) -> None:
        super().__init__(base_url=base_url, token=token, timeout=timeout, env=env)
        self._client = client
        self._owns_client = client is None

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=self.timeout)
        return self._client

    def _post(
        self, path: str, params: dict[str, Any], action: str, timeout: Optional[float] = None
    ) -> Any:
        url = self._url(path)
        try:
            response = self._http().post(
                url, json=params, headers=self._headers(), timeout=timeout or self.timeout
            )
        except httpx.HTTPError as cause:
            raise _unreachable(self.base_url, action, cause) from cause
        try:
            payload = response.json()
        except ValueError as cause:
            raise LinkedInToolkitError(
                code="INTERNAL",
                message=f"{url} returned {response.status_code} with a body that is not JSON.",
                action=action,
            ) from cause
        return _envelope_to_data(payload, action, response.status_code, url)

    def _invoke(self, action: str, params: dict[str, Any]) -> Any:
        return self._post(f"/actions/{action}", params, action)

    def call(self, action: str, params: Optional[dict[str, Any]] = None) -> Any:
        """Call any action by name. The generated methods are the typed way in."""
        return self._invoke(action, params or {})

    def call_tool(self, name: str, arguments: Optional[dict[str, Any]] = None) -> Any:
        """Call one of the 39 MCP tools by name, including the server-local ones."""
        return self._post(f"/tools/{name}", arguments or {}, name, self._timeout_for(name))

    def health(self) -> dict[str, Any]:
        """``GET /health``. No token required, so this works before pairing."""
        url = self._url("/health")
        try:
            response = self._http().get(url, headers={"accept": "application/json"})
        except httpx.HTTPError as cause:
            raise _unreachable(self.base_url, "health", cause) from cause
        return dict(response.json())

    def close(self) -> None:
        if self._client is not None and self._owns_client:
            self._client.close()
            self._client = None

    def __enter__(self) -> "LinkedInToolkit":
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.close()


class AsyncLinkedInToolkit(_Common, ActionMethods):
    """The same surface, awaited.

        async with AsyncLinkedInToolkit() as client:
            data = await client.search_people(keywords="CTO fintech London")

    Every generated action method returns a coroutine here and a value on
    ``LinkedInToolkit``; the method bodies are the same generated code.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        env: Optional[Mapping[str, str]] = None,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        super().__init__(base_url=base_url, token=token, timeout=timeout, env=env)
        self._client = client
        self._owns_client = client is None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def _post(
        self, path: str, params: dict[str, Any], action: str, timeout: Optional[float] = None
    ) -> Any:
        url = self._url(path)
        try:
            response = await self._http().post(
                url, json=params, headers=self._headers(), timeout=timeout or self.timeout
            )
        except httpx.HTTPError as cause:
            raise _unreachable(self.base_url, action, cause) from cause
        try:
            payload = response.json()
        except ValueError as cause:
            raise LinkedInToolkitError(
                code="INTERNAL",
                message=f"{url} returned {response.status_code} with a body that is not JSON.",
                action=action,
            ) from cause
        return _envelope_to_data(payload, action, response.status_code, url)

    def _invoke(self, action: str, params: dict[str, Any]) -> Any:
        return self._post(f"/actions/{action}", params, action)

    async def call(self, action: str, params: Optional[dict[str, Any]] = None) -> Any:
        return await self._post(f"/actions/{action}", params or {}, action)

    async def call_tool(self, name: str, arguments: Optional[dict[str, Any]] = None) -> Any:
        return await self._post(f"/tools/{name}", arguments or {}, name, self._timeout_for(name))

    async def health(self) -> dict[str, Any]:
        url = self._url("/health")
        try:
            response = await self._http().get(url, headers={"accept": "application/json"})
        except httpx.HTTPError as cause:
            raise _unreachable(self.base_url, "health", cause) from cause
        return dict(response.json())

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> "AsyncLinkedInToolkit":
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        await self.aclose()
