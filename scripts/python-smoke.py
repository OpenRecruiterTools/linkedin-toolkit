#!/usr/bin/env python3
"""Drive a running LinkedIn Toolkit server through the published Python client.

This is the Python half of the end-to-end test. It is a script rather than a
`python -c` one-liner so that it is readable, quotable on any shell, and
runnable by hand:

    lit serve --http --fake --port 47830 &
    python scripts/python-smoke.py

It imports `linkedin_toolkit` the way a user would — from the installed package,
not from a path hack — so it fails if the package does not actually install.

It prints one JSON object to stdout and nothing else, so a test can parse it.
Everything diagnostic goes to stderr. Exit code 0 means every call succeeded.

`LINKEDIN_TOOLKIT_URL` and `LINKEDIN_TOOLKIT_TOKEN` are read by the client
itself; `LINKEDIN_TOOLKIT_HOME` also works. Pass nothing and it finds a local
server the same way `lit` does.
"""

from __future__ import annotations

import json
import sys

from linkedin_toolkit import LinkedInToolkit, __version__, resolve_config


def main() -> int:
    config = resolve_config()
    print(f"client {__version__} -> {config!r}", file=sys.stderr)

    out: dict[str, object] = {"clientVersion": __version__, "baseUrl": config.base_url}

    with LinkedInToolkit() as toolkit:
        health = toolkit.health()
        out["health"] = health

        status = toolkit.status_get()
        out["status"] = {
            "connected": status.get("connected"),
            "extensionVersion": status.get("extensionVersion"),
            "loggedIn": status.get("loggedIn"),
            "autopilot": status.get("autopilot"),
            "quotaKinds": sorted((status.get("quotas") or {}).keys()),
            "queuePending": (status.get("queue") or {}).get("pending"),
        }

        search = toolkit.search_people(keywords="platform engineering", count=5)
        profiles = search.get("profiles") or []
        out["search"] = {
            "count": len(profiles),
            "total": search.get("total"),
            "first": (
                {
                    "publicId": profiles[0].get("publicId"),
                    "fullName": profiles[0].get("fullName"),
                    "url": profiles[0].get("url"),
                }
                if profiles
                else None
            ),
        }

        if not profiles:
            print("search returned nothing; cannot invite", file=sys.stderr)
            json.dump(out, sys.stdout)
            return 2

        target = profiles[0]["publicId"]

        # A dry run first: it must preview and queue nothing.
        preview = toolkit.outreach_invite(
            publicId=target, note="Hi there — dry run only.", dry_run=True
        )
        out["inviteDryRun"] = preview

        # Then the real call. In Copilot mode — the default — this queues for a
        # human rather than sending, which is the behaviour worth asserting.
        invite = toolkit.outreach_invite(publicId=target, note="Hi there.")
        out["invite"] = invite

        after = toolkit.status_get()
        out["queuePendingAfterInvite"] = (after.get("queue") or {}).get("pending")

    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
