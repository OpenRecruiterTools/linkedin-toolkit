"""One exception type for every failure this client can produce."""

from __future__ import annotations

from typing import Any, Optional

__all__ = ["ERROR_CODES", "TERMINAL_ERROR_CODES", "LinkedInToolkitError"]

#: The contract's error codes, verbatim from ``docs/actions.md``.
ERROR_CODES: tuple[str, ...] = (
    "EXTENSION_OFFLINE",
    "NOT_LOGGED_IN",
    "RATE_LIMITED",
    "CHALLENGE_DETECTED",
    "QUOTA_EXCEEDED",
    "OUTSIDE_BUSINESS_HOURS",
    "INVALID_PARAMS",
    "NOT_FOUND",
    "LINKEDIN_ERROR",
    "AI_NOT_CONFIGURED",
    "AI_ERROR",
    "UNAUTHORIZED",
    "INTERNAL",
)

#: Codes that must not be retried. Retrying after a challenge is the specific
#: behaviour that turns a LinkedIn warning into an account restriction.
TERMINAL_ERROR_CODES: frozenset[str] = frozenset(
    {"RATE_LIMITED", "QUOTA_EXCEEDED", "CHALLENGE_DETECTED", "NOT_LOGGED_IN"}
)


class LinkedInToolkitError(RuntimeError):
    """Raised for every failed call: transport, auth, params or engine."""

    def __init__(
        self,
        code: str,
        message: str,
        how_to_fix: Optional[str] = None,
        retry_after: Optional[float] = None,
        action: Optional[str] = None,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.how_to_fix = how_to_fix
        self.retry_after = retry_after
        self.action = action

    @classmethod
    def from_envelope(cls, error: dict[str, Any], action: Optional[str] = None) -> "LinkedInToolkitError":
        return cls(
            code=str(error.get("code", "INTERNAL")),
            message=str(error.get("message", "The server did not say what went wrong.")),
            how_to_fix=error.get("howToFix"),
            retry_after=error.get("retryAfter"),
            action=action,
        )

    @property
    def terminal(self) -> bool:
        """True when retrying is the wrong response. See ``TERMINAL_ERROR_CODES``."""
        return self.code in TERMINAL_ERROR_CODES

    @property
    def known(self) -> bool:
        """True when the code is one the contract defines."""
        return self.code in ERROR_CODES

    def to_dict(self) -> dict[str, Any]:
        """The shape an agent framework can hand back to a model as a tool result."""
        payload: dict[str, Any] = {"error": self.code, "message": self.message}
        if self.how_to_fix:
            payload["howToFix"] = self.how_to_fix
        if self.retry_after is not None:
            payload["retryAfter"] = self.retry_after
        if self.action:
            payload["action"] = self.action
        return payload
