# `lit` — the CLI

Ships in the same npm package as the MCP server, so `npx linkedin-toolkit-mcp` already installed
it. Same engine, same caps, same approval queue as everything else.

```bash
npm i -g linkedin-toolkit-mcp   # or just use npx
lit status
```

## Server

```bash
lit serve --http                       # Streamable HTTP MCP + /actions + /openapi.json on 127.0.0.1:47830
lit serve --http --port 8080           # different port
lit serve --http --fake                # fake extension client: no LinkedIn account needed, real envelopes
```

`GET /health` for a liveness check, `GET /openapi.json` for the generated OpenAPI 3.1 document.
Bearer token is `bridge.token` in `~/.linkedin-toolkit/config.json`.

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
lit queue list
lit queue approve <id> [<id>...]
lit queue reject  <id> [<id>...]
```

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
lit config get                                        # the whole config
lit config get webhookUrl                             # one key
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
| `LINKEDIN_TOOLKIT_TOKEN` | — | The bridge token, otherwise read from `~/.linkedin-toolkit/config.json` |

Full action reference: [`actions.md`](actions.md). Shell examples: [`../examples/cli/`](../examples/cli/).
