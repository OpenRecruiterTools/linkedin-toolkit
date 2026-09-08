#!/usr/bin/env bash
# Morning report: quota, queue, campaign performance, inbox. Read-only. Runs in about a second.
#
#   ./daily-report.sh
#   0 8 * * 1-5  cd ~/linkedin-toolkit/examples/cli && ./daily-report.sh | mail -s "LinkedIn" me@example.com

. "$(dirname "$0")/lib.sh"

printf '\nLinkedIn Toolkit — %s\n\n' "$(date '+%A %d %B')"

status="$(act status.get)"

jq -r '
  "  mode        " + (if .autopilot then "AUTOPILOT" else "Copilot (writes queue for approval)" end),
  "  hours       " + (if .businessHours then "inside business hours" else "outside business hours — nothing will send" end),
  "  extension   v" + .extensionVersion + (if .loggedIn then ", logged in" else ", NOT LOGGED IN" end),
  (if .challenge then "  ⚠ CHALLENGE DETECTED — all writes paused until you clear it in Chrome" else empty end),
  (if .backoffUntil then "  ⚠ backing off until " + (.backoffUntil/1000|strftime("%H:%M")) else empty end),
  "",
  "  quota       invites  \(.quotas.invite.dailyUsed)/\(.quotas.invite.dailyCap)",
  "              messages \(.quotas.message.dailyUsed)/\(.quotas.message.dailyCap)",
  "              visits   \(.quotas.visit.dailyUsed)/\(.quotas.visit.dailyCap)",
  "              search   \(.quotas.search.dailyUsed)/\(.quotas.search.dailyCap)",
  "",
  "  queue       \(.queue.pending) awaiting your approval",
  "  campaigns   \(.campaigns.active) active, \(.campaigns.paused) paused",
  ""
' <<<"$status"

echo "  Campaigns"
act campaign.getAll | jq -r '
  if (.campaigns | length) == 0 then "    none"
  else .campaigns[] |
    "    \(.name) — \(.status)" +
    (if .stats then
      "\n      enrolled \(.stats.enrolled)  sent \(.stats.sent)  accepted \(.stats.accepted)  replied \(.stats.replied)  positive \(.stats.positive)" +
      (if .stats.sent > 0 then "\n      accept rate \((.stats.accepted / .stats.sent * 100 | floor))%" else "" end)
     else "" end)
  end'

echo
echo "  Unread since yesterday"
since=$(( ($(date +%s) - 86400) * 1000 ))
act inbox.threads "$(jq -nc --argjson s "$since" '{since:$s, unreadOnly:true, count:20}')" | jq -r '
  if (.threads | length) == 0 then "    nothing new"
  else .threads[] |
    "    \(.participants[0].fullName // "?")" +
    (if .sentiment then "  [\(.sentiment)]" else "" end) +
    "\n      \(.snippet[:100])"
  end'

echo
echo "  Pending approvals"
act queue.list '{"status":"pending"}' | jq -r '
  if (.items | length) == 0 then "    none"
  else .items[] | "    \(.id)  \(.action)  \(.profile.fullName // .params.publicId)" end'

echo
