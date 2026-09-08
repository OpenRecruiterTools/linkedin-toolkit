#!/usr/bin/env bash
# Everyone who liked or commented on a post → a named list you can enroll in a campaign.
#
#   ./engagers-to-list.sh https://www.linkedin.com/posts/... "Post engagers 8 Sep"
#
# This is the highest-intent list you can build on LinkedIn: they read something about your
# problem space and reacted to it in public. No writes.

. "$(dirname "$0")/lib.sh"

POST_URL="${1:?usage: ./engagers-to-list.sh <post-url> \"<list name>\"}"
LIST_NAME="${2:?usage: ./engagers-to-list.sh <post-url> \"<list name>\"}"

require_ready

echo "reading engagers" >&2
engagers='[]'
start=0
while :; do
  page="$(act post.engagers "$(jq -nc --arg u "$POST_URL" --argjson s "$start" \
    '{postUrl:$u, kind:"both", start:$s, count:100}')")"
  batch="$(jq '.engagers' <<<"$page")"
  [ "$(jq 'length' <<<"$batch")" -gt 0 ] || break
  engagers="$(jq -s 'add' <(echo "$engagers") <(echo "$batch"))"
  echo "  $(jq 'length' <<<"$engagers")" >&2
  start="$(jq -r '.nextStart // 0' <<<"$page")"
  [ "$start" -gt 0 ] || break
done

engagers="$(jq 'unique_by(.publicId)' <<<"$engagers")"
total="$(jq 'length' <<<"$engagers")"
echo "$total unique engagers" >&2

list="$(act list.create "$(jq -nc --arg n "$LIST_NAME" '{name:$n, tags:["intent","post-engager"]}')")"
list_id="$(jq -r '.listId' <<<"$list")"

added="$(act list.add "$(jq -nc --arg l "$list_id" --argjson p "$(jq -c '[.[].publicId]' <<<"$engagers")" \
  '{listId:$l, publicIds:$p}')")"

jq -r --arg n "$LIST_NAME" --arg l "$list_id" \
  '"list \"\($n)\" (\($l)): \(.added) added, \(.duplicates) already there"' <<<"$added" >&2

# Who commented is a warmer signal than who liked.
echo >&2
echo "commented (warmest first):" >&2
jq -r '[.[] | select(.commentText)] | .[:10] | .[] | "  \(.fullName) — \(.headline // "")\n    \"\(.commentText[:120])\""' <<<"$engagers" >&2

echo >&2
echo "next: lit campaign create --from sequences/sales-post-engager.json --list \"$LIST_NAME\"" >&2
