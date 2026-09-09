# Publishing to the official MCP Registry

The [official MCP Registry](https://registry.modelcontextprotocol.io) is no longer a pull request
against a list — it is an API you publish to with the `mcp-publisher` CLI. The registry stores
**metadata only**; the artefact still lives on npm. So the order matters: npm first, registry
second.

Everything a machine can prepare is already in the repo:

| Thing | Where | State |
| --- | --- | --- |
| `mcpName` ownership marker | `mcp-server/package.json` | `io.github.OpenRecruiterTools/linkedin-toolkit` |
| Server manifest | `server.json` (repo root) | schema `2025-12-11`, validates clean |
| `mcp-publisher` CLI | `E:\Dev\tools\mcp-publisher\mcp-publisher.exe` | v1.8.1, Windows amd64 |

The steps below need credentials and a browser, so only Dominic can run them.

---

## 0. Preconditions

- `server.json` and `mcp-server/package.json` both say `2.0.1`, and `server.json`'s `name` is
  character-for-character equal to `package.json`'s `mcpName`. The registry rejects the publish if
  they differ.
- The GitHub account used at step 2 must be an **Owner** of the `OpenRecruiterTools` organisation.
  Plain membership is no longer enough: the registry reads your org role and only grants the
  `io.github.OpenRecruiterTools/*` namespace to owners. `FormatixAI` is an owner, so the device
  flow below is all that is needed — there is no separate org-verification step, no DNS record and
  nothing to configure on the GitHub org itself.
- Re-validate before you start (this does not talk to your account, only to the registry's schema
  endpoint):

```bash
cd D:\Projects\linkedin-toolkit
E:\Dev\tools\mcp-publisher\mcp-publisher.exe validate
# ✅ server.json is valid
```

---

## 1. Publish the npm package — ⚠️ IRREVERSIBLE

The registry fetches `linkedin-toolkit-mcp@2.0.1` from npm and looks for `mcpName` inside its
`package.json`. If the version is not on npm yet, the registry publish fails with
*"Registry validation failed for package"*.

```bash
cd D:\Projects\linkedin-toolkit
npm whoami                                    # confirm the right account
npm publish -w mcp-server --dry-run           # read the file list first
npm publish -w mcp-server --access public     # 2FA: npm prompts for the OTP, or use --otp=123456
```

Verify it landed, and that the marker shipped with it:

```bash
npm view linkedin-toolkit-mcp version         # 2.0.1
npm view linkedin-toolkit-mcp mcpName         # io.github.OpenRecruiterTools/linkedin-toolkit
```

If `mcpName` comes back empty, the registry will not accept the publish — fix and ship `2.0.2`;
npm versions cannot be replaced.

---

## 2. Authenticate — ↩️ reversible

GitHub device flow. It prints a code, you paste it into a browser.

```bash
E:\Dev\tools\mcp-publisher\mcp-publisher.exe login github
```

```text
To authenticate, please:
1. Go to: https://github.com/login/device
2. Enter code: ABCD-1234
3. Authorize this application
Waiting for authorization...
✓ Successfully logged in
```

The token is written to `~/.config/mcp-publisher/token.json`. It grants `io.github.<your-username>/*` always,
and `io.github.OpenRecruiterTools/*` because the account owns the org. The registry never reads
or writes repository content.

> CI variant, for later: either `mcp-publisher login github --token=<PAT>` with a classic PAT
> carrying the `read:org` scope (or a fine-grained PAT with **Organization permissions → Members →
> Read-only**), or `mcp-publisher login github-oidc` from a workflow that has `id-token: write`.
> Without the org-read permission GitHub reports no org membership and the publish silently falls
> back to the personal namespace. No repository scopes are needed either way.

## 3. Publish to the registry — ⚠️ IRREVERSIBLE

Run from the repo root, where `server.json` lives:

```bash
cd D:\Projects\linkedin-toolkit
E:\Dev\tools\mcp-publisher\mcp-publisher.exe publish
```

```text
Publishing to https://registry.modelcontextprotocol.io...
✓ Successfully published
✓ Server io.github.OpenRecruiterTools/linkedin-toolkit version 2.0.1
```

## 4. Log out — ↩️ reversible

```bash
E:\Dev\tools\mcp-publisher\mcp-publisher.exe logout
```

---

## 5. Verify

```bash
curl "https://registry.modelcontextprotocol.io/v0/servers?search=linkedin-toolkit"
```

The response should contain a server object whose `name` is
`io.github.OpenRecruiterTools/linkedin-toolkit`, whose `version` is `2.0.1`, and whose `_meta`
block reports `"status": "active"` and `"isLatest": true`. The newer `/v0.1/servers` path works
too and takes the same `search` parameter:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.OpenRecruiterTools/linkedin-toolkit"
```

Downstream directories (Cursor, VS Code, PulseMCP, Glama and the rest) mirror the official
registry on their own schedules — expect hours to days, not minutes.

---

## Publishing a later version

1. Bump `mcp-server/package.json` **and** the two `version` fields in `server.json` (top level and
   the npm package entry) to the same number.
2. `npm publish -w mcp-server --access public`
3. `mcp-publisher login github && mcp-publisher publish && mcp-publisher logout`

Versions are append-only: the registry keeps the history and marks the newest one `isLatest`.
There is no edit, only a new version.

## Constraints worth remembering

- **`description` is capped at 100 characters** by the schema. Ours is 93. A longer one fails
  validation, not with a friendly message but as a schema error.
- `name` is capped at 200 and must match `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$` — exactly one slash.
- Only `https://registry.npmjs.org` is accepted for npm packages. No mirrors, no private
  registries.
- There is no way to describe the toolkit's local HTTP API (`lit serve --http`) as a `remotes`
  entry: `remotes` is for endpoints the registry can reach on the public internet, and
  `http://127.0.0.1:31337` is neither reachable nor meaningful to anyone else. The stdio package
  entry is the whole listing.
- `_meta` is dropped on publish unless it sits under
  `io.modelcontextprotocol.registry/publisher-provided` (4 KB limit). We do not use it.
