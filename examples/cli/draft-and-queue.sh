#!/usr/bin/env bash
# Read a CSV of publicIds, dry-run an invite for each, then queue them for human approval.
#
#   ./draft-and-queue.sh out.csv           # dry run only, sends nothing, queues nothing
#   ./draft-and-queue.sh out.csv --queue   # queue them for approval in the popup
#
# Nothing here can send. In Copilot mode the engine queues every agent-originated write; the
# human approves in the extension popup or with queue.approve.

. "$(dirname "$0")/lib.sh"

CSV="${1:?usage: ./draft-and-queue.sh <csv> [--queue]}"
QUEUE="${2:-}"

require_ready
echo >&2

# Skip the header row; column 1 is publicId, 2 fullName, 5 company.
tail -n +2 "$CSV" | while IFS=, read -r public_id full_name headline title company rest; do
  public_id="$(tr -d '"' <<<"$public_id")"
  full_name="$(tr -d '"' <<<"$full_name")"
  company="$(tr -d '"' <<<"$company")"
  [ -n "$public_id" ] || continue

  first_name="${full_name%% *}"
  note="Hi ${first_name:-there} — what ${company:-your team} is building keeps coming up in conversations I'm having. Would be good to connect properly."

  if [ "${#note}" -gt 300 ]; then
    echo "SKIP $public_id — note is ${#note} characters, limit is 300" >&2
    continue
  fi

  params="$(jq -nc --arg p "$public_id" --arg n "$note" '{publicId:$p, note:$n, dry_run:true}')"
  act outreach.invite "$params" | jq -r --arg n "$full_name" --argjson len "${#note}" \
    '"DRY  \($n)  (\($len) chars)\n     \(.wouldSend.note)"'

  if [ "$QUEUE" = "--queue" ]; then
    real="$(jq -nc --arg p "$public_id" --arg n "$note" '{publicId:$p, note:$n}')"
    result="$(act outreach.invite "$real")"
    status="$(jq -r '.status' <<<"$result")"
    case "$status" in
      queued) echo "     → queued as $(jq -r '.queueId' <<<"$result")" ;;
      sent)   echo "     → SENT (Autopilot is on)" ;;
      *)      echo "     → $status" ;;
    esac
  fi
  echo
done

if [ "$QUEUE" = "--queue" ]; then
  echo "pending approvals:" >&2
  act queue.list '{"status":"pending"}' \
    | jq -r '.items[] | "  \(.id)  \(.profile.fullName // .params.publicId)  \(.action)"'
  echo >&2
  echo "approve in the extension popup, or:" >&2
  echo "  curl -X POST \$LINKEDIN_TOOLKIT_URL/actions/queue.approve -H \"authorization: Bearer \$LINKEDIN_TOOLKIT_TOKEN\" -H 'content-type: application/json' -d '{\"ids\":[\"q_...\"]}'" >&2
fi
