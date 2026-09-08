# Security Policy

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private reporting:
[Report a vulnerability](https://github.com/FormatixAI/linkedin-toolkit/security/advisories/new)

Or email **dom@formatix.ai** with `[linkedin-toolkit security]` in the subject.

Please include: what the issue is, how to reproduce it, what an attacker could do with it, and the
versions affected. A proof of concept helps enormously — but **never** include real people's
personal data in it.

**What to expect:** an acknowledgement within 72 hours, an assessment within 7 days, and a fix
released as fast as severity warrants. You will be credited in the advisory and the changelog
unless you would rather not be. This is an unfunded open-source project and there is no bounty.

Please give a reasonable disclosure window — 90 days is the usual courtesy, sooner if a fix ships
sooner.

## What is in scope

The parts of this project that hold or move data:

- **The bridge** — `ws://127.0.0.1:47829`. Pairing token handling, authentication bypass, anything
  reachable from another origin or another process on the machine.
- **The HTTP server** — `lit serve --http` on `127.0.0.1:47830`. Bearer token handling, DNS
  rebinding, CORS, request forgery from a web page the user has open.
- **`linkedin_query_sql`** — SQL injection, or any route to a write through the read-only path.
- **The extension** — content script injection, message-passing between the page and the service
  worker, `chrome.storage` handling of API keys and the bridge token, anything a hostile web page
  could reach.
- **Credential handling** — BYOK model provider keys, enrichment provider keys, the bridge token.
  Any path that logs, transmits, or persists one where it should not be.
- **Personal data leakage** — profile data, message bodies or Research Packs leaving the machine
  through any route the user did not explicitly configure.
- **The supply chain** — a compromised or typosquatted dependency in `linkedin-toolkit-mcp` or the
  client packages.
- **Webhooks** — SSRF through a configured webhook URL, or leaking the bearer token to it.

Practical severity guide: anything that lets code outside the extension issue LinkedIn actions as
the user, that exfiltrates a token or key, or that lets a web page reach the bridge or the HTTP API
is **high**. Anything that raises a cap or bypasses the approval queue is **high** — those controls
are the safety model, not a convenience.

## What is out of scope

- **That the tool automates LinkedIn.** That is what it does, it is documented in bold in the
  README, and it is a terms-of-service matter rather than a vulnerability.
- **LinkedIn detecting the tool.** Not a bug. This project does not do detection evasion and will
  not accept contributions that do.
- **The absence of authentication between the user and their own machine.** The bridge and the HTTP
  API bind to `127.0.0.1` and are token-authenticated. An attacker who already has code execution
  on the machine has already won.
- **Exposure caused by deliberately tunnelling the local server** to the public internet. The risks
  are documented in [docs/agents/chatgpt-connector.md](docs/agents/chatgpt-connector.md); doing it
  anyway is a choice, not a vulnerability.
- **Social engineering, physical access, or anything requiring the user to install a malicious
  extension alongside this one.**
- **Missing hardening with no demonstrable impact** — a header, a flag, a scanner finding with no
  attack behind it.

## Supported versions

The latest minor release. This is a small project; there are no long-term support branches.

| Version | Supported |
|---|---|
| 2.x | ✅ |
| 1.x | ❌ — upgrade |

## For users

A few things worth knowing, none of which are vulnerabilities but all of which are your
responsibility:

- **Your data is local.** `chrome.storage.local`, IndexedDB, and
  `~/.linkedin-toolkit/toolkit.db`. Anyone with access to your machine or your Chrome profile has
  access to all of it. It is not encrypted at rest beyond whatever your disk encryption provides.
- **The bridge token** is in `~/.linkedin-toolkit/config.json` in plain text. Treat it as a
  credential — anyone holding it, with network access to the port, can act on your LinkedIn
  account. Rotate it with `lit config set bridge.token <new>` and re-pair the popup.
- **BYOK API keys** live in `chrome.storage.local`. Use a key scoped to this and nothing else.
- **Install the extension from the GitHub Releases page only.** It is deliberately not on the
  Chrome Web Store, which unfortunately makes a fake listing an obvious attack — verify the
  publisher before you load anything unpacked.
- **The npm package is `linkedin-toolkit-mcp`.** Check the spelling. Typosquats are the cheapest
  attack on any popular package.
