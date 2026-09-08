#!/usr/bin/env bash
# Shared helpers for the CLI examples. Source it:  . ./lib.sh
#
# Everything here is one curl call and a jq filter. If you can read this file you can call any
# action in ../../docs/actions.md without a client library.

set -euo pipefail

# The only two environment variables the toolkit reads.
LINKEDIN_TOOLKIT_URL="${LINKEDIN_TOOLKIT_URL:-http://127.0.0.1:47830}"
CONFIG="$HOME/.linkedin-toolkit/config.json"

if [ -z "${LINKEDIN_TOOLKIT_TOKEN:-}" ]; then
  if [ -f "$CONFIG" ]; then
    LINKEDIN_TOOLKIT_TOKEN="$(jq -r '.bridge.token' "$CONFIG")"
  else
    echo "No token. Set LINKEDIN_TOOLKIT_TOKEN, or start the server once so $CONFIG exists." >&2
    exit 1
  fi
fi

# act <action> [json-params]  ->  the "data" object on success; prints the error and exits on failure.
act() {
  local action="$1"
  local params="${2:-}"
  [ -n "$params" ] || params='{}'
  local response

  response="$(curl -sS -X POST "$LINKEDIN_TOOLKIT_URL/actions/$action" \
    -H "authorization: Bearer $LINKEDIN_TOOLKIT_TOKEN" \
    -H 'content-type: application/json' \
    -d "$params")"

  if [ "$(jq -r '.ok' <<<"$response")" != "true" ]; then
    jq -r '"\(.error.code): \(.error.message)" + (if .error.howToFix then "\n  fix: " + .error.howToFix else "" end) + (if .error.retryAfter then "\n  retry after: " + (.error.retryAfter/1000|floor|tostring) + "s" else "" end)' \
      <<<"$response" >&2
    exit 1
  fi

  jq '.data' <<<"$response"
}

# Refuse to run if the engine is not in a state to do useful work.
require_ready() {
  local status
  status="$(act status.get)"

  [ "$(jq -r '.loggedIn' <<<"$status")" = "true" ] || {
    echo "Not logged in to LinkedIn in Chrome." >&2; exit 1;
  }
  [ "$(jq -r '.challenge // empty' <<<"$status")" = "" ] || {
    echo "CHALLENGE_DETECTED — clear it in Chrome before running anything else." >&2; exit 1;
  }

  jq -r '"quota  invites \(.quotas.invite.dailyUsed)/\(.quotas.invite.dailyCap)  messages \(.quotas.message.dailyUsed)/\(.quotas.message.dailyCap)  visits \(.quotas.visit.dailyUsed)/\(.quotas.visit.dailyCap)  search \(.quotas.search.dailyUsed)/\(.quotas.search.dailyCap)"' <<<"$status" >&2
  jq -r 'if .autopilot then "mode   AUTOPILOT — writes send without approval" else "mode   COPILOT — writes queue for your approval" end' <<<"$status" >&2
}
