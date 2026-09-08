# linkedin-toolkit-mcp

The MCP server, localhost bridge, HTTP action API, SQLite mirror and `lit` CLI for
[LinkedIn Toolkit](https://github.com/OpenRecruiterTools/linkedin-toolkit).

This package is the half that agents talk to. The other half is a Chrome extension that drives
**your own logged-in LinkedIn session** — there is no headless browser, no hosted service, no
account and no telemetry. This server does not touch LinkedIn itself; it hands actions to the
extension over a WebSocket on loopback and passes the answers back.

```bash
npx linkedin-toolkit-mcp
```

## Pairing

1. Install the extension: download the `linkedin-toolkit-extension-*.zip` from
   [Releases](https://github.com/OpenRecruiterTools/linkedin-toolkit/releases), unzip it, then
   `chrome://extensions` → **Developer mode** → **Load unpacked** → pick the folder.
2. Run `npx linkedin-toolkit-mcp`. The first run prints a pairing token and stores it in
   `~/.linkedin-toolkit/config.json` (owner-only).
3. Paste that token into the extension popup → **Settings → Local bridge**, and enable the bridge.
   The badge turns to "connected".

Point your agent at the server. Claude Code, `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "linkedin-toolkit": { "command": "npx", "args": ["-y", "linkedin-toolkit-mcp"] }
  }
}
```

`lit serve --http` additionally exposes `POST /actions/{action}`, `POST /mcp` and
`GET /openapi.json` on `127.0.0.1:47830` for the Node and Python clients, n8n and anything else
that speaks HTTP. Everything binds to loopback and requires the pairing token as a bearer token.

Add `--fake` to any `serve` to run the whole surface without a LinkedIn account: real envelopes,
real error codes, demo data, no network calls.

## `lit` cheat-sheet

```bash
lit serve --http                       # run the bridge + HTTP API (add --fake for demo mode)
lit status                             # connection, quotas, business hours, queue depth
lit config get token --reveal          # the pairing token
lit search "CTO fintech London" --json # sourcing; --csv also works
lit profile ada-lovelace --json
lit invite ada-lovelace --note "…"     # queues for approval in Copilot mode
lit queue list                         # what is waiting for you
lit queue approve <id>                 # you, at your own terminal
lit sync && lit sql "select * from profiles limit 5"
lit research rows.csv --out packs/     # research packs from a CSV
```

`lit --help` lists everything.

## Safety

Copilot mode is on by default: invites, messages, InMails and comments from an agent wait in an
approval queue until a human approves them in the popup. Views, follows and likes are metered
against the visit bucket and go out directly. Daily hard caps live in the extension and cannot be
raised by this server, the CLI, an agent or a config file.

Automating your LinkedIn account may breach LinkedIn's User Agreement, and accounts are restricted
and banned for it. That risk is yours. Read
[docs/safety.md](https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/master/docs/safety.md) before
you point anything at an account you care about.

## Documentation

- [Action contract](https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/master/docs/actions.md) —
  every action, param, result, error code and event.
- [Agent setup](https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/master/docs/agents/README.md) —
  Claude Code, OpenAI Agents, LangChain, n8n and the rest.
- [Safety](https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/master/docs/safety.md).

MIT licensed. Issues and pull requests:
<https://github.com/OpenRecruiterTools/linkedin-toolkit>
