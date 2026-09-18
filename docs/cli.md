# `lit` — the CLI

Ships in the same npm package as the MCP server, so `npx linkedin-toolkit-mcp` already installed
it. Same engine, same caps, same approval queue as everything else.

```bash
npm i -g linkedin-toolkit-mcp   # or just use npx
lit status
```

## Setup

```bash
npx linkedin-toolkit-mcp setup                 # nothing installed yet? start here
lit setup --client claude-code                 # ...or once the package is on your PATH
lit setup --client cursor --dry-run            # print everything it would do; write nothing
lit setup --dir ~/Documents/lit-extension      # unpack somewhere other than ~/.linkedin-toolkit
lit setup --version 2.0.4 --no-open --wait 0   # a specific release, no Chrome, no pairing wait
```

Downloads the extension zip for this package's version (falling back to the latest release, and
saying so), checks it is a zip carrying an MV3 `manifest.json`, and unpacks it to
`~/.linkedin-toolkit/extension` — staged beside the old copy and swapped in, so a failed run
leaves a working extension. Then it prints the three Chrome steps with the exact folder path,
starts or detects a server, prints the pairing token, waits (default 120s, `--wait 0` to skip) for
the extension to connect, and merges the MCP config into your client's own file.

`--client` takes `claude-desktop`, `claude-code`, `cursor`, `windsurf`, `vscode`, `n8n` or
`print`. The file-backed ones are backed up to `<file>.bak-<timestamp>` before they are touched,
every other server in them is preserved, and a file that is not valid JSON is refused rather than
rewritten. `n8n` and `print` only print, because there is no file on this machine to merge into.
Paths and shapes per client: [`clients.md`](clients.md).

Chrome ignores `chrome://` URLs handed to it on the command line in most builds, so setup asks and
then tells you to type the URL if nothing appeared — it never claims a page opened. `--no-open`
skips even asking.

## Server

```bash
lit serve --http                       # Streamable HTTP MCP + /actions + /openapi.json on 127.0.0.1:47830
lit serve --http --port 8080           # different port
lit serve --http --fake                # fake extension client: no LinkedIn account needed, real envelopes
```

`GET /health` for a liveness check, `GET /openapi.json` for the generated OpenAPI 3.1 document.
Bearer token is `token` in `~/.linkedin-toolkit/config.json`, or run `lit config get token --reveal`.

## Diagnose

```bash
lit endpoints check                    # self-test every LinkedIn endpoint the extension uses
lit endpoints check --post <post-url>  # also check the reactions endpoint
lit endpoints check --json             # the raw status.get { verify: true } envelope
lit endpoints doctor                   # the same run, explained: which hash is stale, and where
lit endpoints doctor --json            # explained, with the raw envelope underneath
```

Run this first when anything returns `LINKEDIN_ERROR`. One read-only call per endpoint, reported as
`ok`, `failed`, `unverified` (never checked against the current LinkedIn client) or `skipped`
(nothing on this account to check it against), each with the client version the endpoint table was
captured against. **Both exit 2 if any endpoint failed**, so a script can tell "an endpoint broke"
from "the command could not run": a `failed` row means LinkedIn moved, not that the toolkit is
broken. `doctor` names the query whose id went stale, the `ENDPOINTS` key holding it, the file, and
the re-capture procedure — see [`voyager-endpoints.md`](voyager-endpoints.md#re-capturing).

**No hosted CI can run these**, here or in a fork: they need a signed-in LinkedIn session in a real
browser on your own machine. Drift is found by whoever hits it first, and reported with the
`--json` output through the endpoint drift issue template. The pass costs one search result and one
profile visit against the daily caps, metered exactly as the real actions are.

## Read

```bash
lit status                                                     # quota, mode, queue, campaigns
lit search "CTO fintech London" --source salesnav --count 100 --csv out.csv
lit profile https://www.linkedin.com/in/... --full --json
lit engagers <post-url> --list "Post engagers 8 Sep"
lit inbox --since 24h --sentiment
```

## Write

Everything here queues in Copilot mode. `--dry-run` on any of them prints what would be sent and
touches nothing.

```bash
lit invite <profile-url> --note "..."
lit message <profile-url> --body "..."
lit campaign create --from sequences/warm-connect.json --list "Data leads"
lit campaign pause <campaignId>
lit queue list                                                # pending by default
lit queue list --status sent|failed|approved|pending|rejected
lit queue approve <id> [<id>...]                              # marks them; sending follows
lit queue reject  <id> [<id>...]
```

`lit queue approve` returns as soon as the items are marked. The extension then sends them one at
a time at human pace — seconds to minutes, depending on your delay settings — so check the outcome
with `lit queue list --status sent` and `--status failed`, which shows why each one failed.
A note longer than LinkedIn's 200 characters is refused at approval time, and nothing is approved.

## Research Pack

```bash
lit research input.csv --out ./packs                  # resolve, capture, signals, dossier per row
lit research input.csv --out ./packs --resolve-only   # dry-run the matching before spending quota
```

Writes `pack.md` and `pack.json` per row plus an enriched `output.csv`, and creates a list. A large
CSV is spread over days by the engine; the ETA is printed up front. Use the
[`linkedin-research-pack` skill](../skills/linkedin-research-pack/SKILL.md) to add the public-web
layer with your agent's own search tool.

## Local data

```bash
lit sql "select company, count(*) from profiles group by 1 order by 2 desc limit 20"
lit export --table profiles --csv
lit sync                                              # pull everything changed into SQLite
```

`SELECT` only, over `~/.linkedin-toolkit/toolkit.db`. No network, no quota.

## Config

```bash
lit config get                                        # the whole config, token redacted
lit config get webhookUrl                             # one key
lit config get token --reveal                         # print the bridge token in full
lit config set webhookUrl https://your-n8n/webhook/linkedin-events
lit config set dailyInviteCap 20
lit token rotate                                      # new bridge token; re-pair the popup after
```

Hard ceilings are clamped regardless of what you pass: 100 invites, 150 messages, 500 profile
visits, 1,000 search results per day. Autopilot cannot be set from here — it is a toggle in the
extension popup and only a human can flip it.

`lit token rotate` invalidates the current bridge token immediately, so anything holding it — the
extension, a running client, a tunnel you handed to a remote agent — stops working until you
re-pair. That is the point of it.

## Environment

Two variables, both optional. The Node and Python clients read them; so does `lit` when it is
talking to an already-running server.

| Variable | Default | What |
|---|---|---|
| `LINKEDIN_TOOLKIT_URL` | `http://127.0.0.1:47830` | Where the HTTP surface is |
| `LINKEDIN_TOOLKIT_TOKEN` | — | The bridge token, otherwise read from `token` in `~/.linkedin-toolkit/config.json` |

Full action reference: [`actions.md`](actions.md). Shell examples: [`../examples/cli/`](../examples/cli/).
