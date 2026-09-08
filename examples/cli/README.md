# CLI

Five bash scripts, `curl` and `jq`, no dependencies. If you can read
[`lib.sh`](lib.sh) you can call every action in the toolkit without a client library.

| Script | Does | Writes? |
|---|---|---|
| [`lib.sh`](lib.sh) | `act <action> <json>` helper + `require_ready` preflight | — |
| [`source-to-csv.sh`](source-to-csv.sh) | Search, page, dedupe, drop existing connections, write a CSV | no |
| [`engagers-to-list.sh`](engagers-to-list.sh) | Post likers and commenters → a named list | no |
| [`draft-and-queue.sh`](draft-and-queue.sh) | CSV → dry-run invites → queue for human approval | queues only |
| [`daily-report.sh`](daily-report.sh) | Quota, queue, campaign stats, unread inbox | no |

## Run

```bash
npx linkedin-toolkit-mcp        # pair the extension once
lit serve --http --fake         # drop --fake for a real session

chmod +x *.sh
./daily-report.sh
./source-to-csv.sh "CTO fintech London" ctos.csv 100
./draft-and-queue.sh ctos.csv           # dry run — nothing queued, nothing sent
./draft-and-queue.sh ctos.csv --queue   # queued for approval in the popup
```

Requires `bash`, `curl`, and `jq`. On Windows, Git Bash or WSL.

## `lit` does most of this in one line

These scripts exist to show the HTTP surface. For day-to-day work the bundled CLI is shorter:

```bash
lit status
lit search "CTO fintech London" --source salesnav --count 100 --csv out.csv
lit profile https://www.linkedin.com/in/... --full --json
lit engagers <post-url> --list "Post engagers 8 Sep"
lit invite <profile-url> --note "..."          # queues in Copilot mode
lit campaign create --from sequences/warm-connect.json --list "..."
lit inbox --since 24h --sentiment
lit research input.csv --out ./packs
lit sql "select company, count(*) from profiles group by 1 order by 2 desc limit 20"
lit export --table profiles --csv
```

`lit` ships in the same npm package as the MCP server, so `npx linkedin-toolkit-mcp` already put
it on your machine. Full reference: [`../../docs/cli.md`](../../docs/cli.md).

## The pattern, in four lines

```bash
curl -sS -X POST "$LINKEDIN_TOOLKIT_URL/actions/search.people" \
  -H "authorization: Bearer $LINKEDIN_TOOLKIT_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"keywords":"CTO fintech London","count":50}' | jq '.data.profiles'
```

Success is `{ "ok": true, "data": …, "rateLimit": … }`; failure is
`{ "ok": false, "error": { "code", "message", "retryAfter", "howToFix" } }`. `lib.sh`'s `act()`
unwraps the first and prints the second to stderr before exiting non-zero, which is why none of
these scripts contain error handling of their own.

## Two habits worth copying

**Preflight.** `require_ready` refuses to run if you are not logged in or a challenge is
outstanding, and prints your remaining quota and current mode to stderr before doing anything.
Every script starts with it. A script that discovers halfway through 80 profiles that the account
was challenged has already done the damage.

**Dry run first.** `draft-and-queue.sh` with no flag calls `outreach.invite` with
`dry_run: true`, which returns `{ "status": "dryRun", "wouldSend": … }` and touches nothing. You
read what would go out, in full, before any of it is real. Every write action accepts `dry_run`.

## Scheduling

`daily-report.sh` is read-only and safe to cron:

```cron
0 8 * * 1-5  cd ~/linkedin-toolkit/examples/cli && ./daily-report.sh | mail -s "LinkedIn" me@example.com
```

Do not cron anything that writes. The engine already schedules sends inside your business hours
with jittered delays — a cron job on top of it just means two things pacing the same account, and
the one you cannot see will win.
