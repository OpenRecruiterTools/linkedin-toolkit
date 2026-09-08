#!/usr/bin/env bash
# Search LinkedIn, deduplicate, drop existing connections, write a CSV.
#
#   ./source-to-csv.sh "CTO fintech London" out.csv [count]
#
# No writes. Spends search quota and nothing else.

. "$(dirname "$0")/lib.sh"

KEYWORDS="${1:?usage: ./source-to-csv.sh \"<keywords>\" <out.csv> [count]}"
OUT="${2:?usage: ./source-to-csv.sh \"<keywords>\" <out.csv> [count]}"
COUNT="${3:-50}"

require_ready

echo "searching: $KEYWORDS" >&2
profiles="$(act search.people "$(jq -nc --arg k "$KEYWORDS" --argjson c "$COUNT" \
  '{keywords:$k, source:"search", start:0, count:$c}')" | jq '.profiles')"

# Page until we have COUNT or the results run out. nextStart is null when there is no more.
start="$(jq 'length' <<<"$profiles")"
while [ "$(jq 'length' <<<"$profiles")" -lt "$COUNT" ] && [ "$start" -gt 0 ]; do
  page="$(act search.people "$(jq -nc --arg k "$KEYWORDS" --argjson s "$start" --argjson c "$COUNT" \
    '{keywords:$k, source:"search", start:$s, count:$c}')")"
  new="$(jq '.profiles' <<<"$page")"
  [ "$(jq 'length' <<<"$new")" -gt 0 ] || break
  profiles="$(jq -s 'add' <(echo "$profiles") <(echo "$new"))"
  start="$(jq -r '.nextStart // 0' <<<"$page")"
  echo "  $(jq 'length' <<<"$profiles") so far" >&2
done

# Deduplicate on publicId.
profiles="$(jq 'unique_by(.publicId)' <<<"$profiles")"
echo "deduplicated to $(jq 'length' <<<"$profiles")" >&2

# Drop anyone already connected or with an invite pending.
ids="$(jq -c '[.[].publicId]' <<<"$profiles")"
statuses="$(act network.status "$(jq -nc --argjson i "$ids" '{publicIds:$i}')" | jq '.statuses')"
profiles="$(jq --argjson s "$statuses" '[.[] | select($s[.publicId] == "none" or $s[.publicId] == null)]' <<<"$profiles")"
echo "$(jq 'length' <<<"$profiles") with no existing relationship" >&2

# CSV, quoted properly.
{
  echo 'publicId,fullName,headline,title,company,location,url'
  jq -r '.[] | [.publicId, .fullName, (.headline // ""), (.title // ""), (.company // ""), (.location // ""), .url] | @csv' <<<"$profiles"
} > "$OUT"

echo "wrote $OUT" >&2
