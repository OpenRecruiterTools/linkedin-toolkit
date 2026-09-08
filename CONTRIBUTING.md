# Contributing

Contributions are genuinely welcome, and there is a lot here that does not require touching the
engine.

## The fastest useful things

| | Effort | Guide |
|---|---|---|
| **A sequence template** | An afternoon, no JavaScript | [sequences/README.md](sequences/README.md) |
| **An extractor** — a new LinkedIn data source | An afternoon, four files | [docs/build-an-extractor.md](docs/build-an-extractor.md) |
| **A skill** | An afternoon, markdown only | [skills/README.md](skills/README.md) |
| **An agent integration** | A day | [examples/](examples/) for the shape |
| **Docs** | Anything from a typo up | — |

Start with a [good first issue](https://github.com/OpenRecruiterTools/linkedin-toolkit/labels/good%20first%20issue).
They name the files to touch and say what "done" means.

## Setup

```bash
git clone https://github.com/OpenRecruiterTools/linkedin-toolkit
cd linkedin-toolkit
npm ci
npm test
```

**The extension** has no build step. Load `extension/` unpacked via `chrome://extensions` →
Developer mode → Load unpacked. Reload the extension after editing; reload the LinkedIn tab after
editing a content script.

**The server:**

```bash
npm run build -w mcp-server
node mcp-server/dist/cli.js serve --http --fake
```

`--fake` runs the fake extension client from the test suite — real envelopes, real error codes,
synthetic people. **Develop against it.** You should not need a LinkedIn account to work on this,
and you certainly should not need to risk one.

**Sequences** need nothing installed:

```bash
node sequences/validate.mjs
```

## The rules that are not negotiable

These come from the design, not from taste. A PR that breaks one will be declined however good it
otherwise is.

1. **No headless browser.** No Playwright, Puppeteer, Selenium, or CDP — not in the extension, not
   in the server, not in tests, not in examples. The entire value proposition is that this is not
   a browser bot. CI fails the build if one appears. Why:
   [docs/why-browser-agents-fail-on-linkedin.md](docs/why-browser-agents-fail-on-linkedin.md).

2. **No hosted anything.** No server, no cloud session, no shared state between users, no
   telemetry. If a feature needs a backend it is a fork, not a PR. This is the entire privacy and
   safety story, and there is a list of good ideas declined on exactly this basis in
   [docs/roadmap.md](docs/roadmap.md).

3. **Nothing that raises the caps or bypasses the queue.** 100 invites, 150 messages, 500 profile
   visits, 1,000 search results per day, enforced in the extension below every client. No config
   flag, no parameter, no "advanced mode". The approval queue is on by default and only a human,
   in the popup, can turn it off.

4. **No detection evasion.** No fingerprint spoofing, no proxies, no CAPTCHA solving, no challenge
   circumvention, no cookie import, no accounts the user is not signed into. When LinkedIn puts up
   a wall, the tool stops. There is no retry loop in this codebase and there will not be one.

5. **No real personal data, anywhere.** Not in fixtures, not in tests, not in screenshots, not in
   issue reports. Anonymise before you commit. This is the mistake that is hardest to undo.

6. **Tests run offline.** No live LinkedIn calls in CI, ever. Recorded fixtures and the fake
   bridge.

7. **`docs/actions.md` is the source of truth.** A new action, error code or event is only real
   once it is in that table. Update it in the same PR, first.

## Style

- **JavaScript in the extension.** Vanilla ES modules, MV3, no runtime dependencies, no build step.
  Keep it that way — the extension has to be readable by anyone who unzips it.
- **TypeScript in the server and clients.** Strict. `zod` at every boundary.
- **Python ≥ 3.10**, type hints, `httpx`.
- ESLint and Prettier are configured; `npm run lint` is the arbiter, not opinion.
- Comments explain **why**, not what. If the code needs a comment to say what it does, rename
  something instead.

### Tool and action descriptions are prompts

A tool description is the only thing a model reads before deciding whether and how to call it.
Say what it returns, what it costs in quota, and anything that would make a model misuse it.

- ✗ "Gets company followers."
- ✓ "Everyone following a company page. Paged: pass the returned nextStart as start. Each result
  spends search quota from the daily cap of 1,000."

### Design notes live outside the repo

`docs/` is documentation for people using and contributing to the toolkit. Internal design notes —
specs, implementation plans, workstream reports — are kept outside the repository and are
gitignored (`docs/superpowers/`, `.superpowers/`); they name work and products that are nobody
else's business, and everything a contributor actually needs belongs in `docs/actions.md`,
`docs/safety.md` or a comment next to the code.

## Commits and PRs

Conventional commits: `feat(sequences):`, `fix(extension):`, `docs:`, `test(mcp-server):`,
`chore(ci):`.

One logical change per PR. A 40-file PR that does three things gets reviewed slowly and merged
reluctantly.

Open a **draft PR early** if you are unsure about the shape, especially for anything touching the
contract. Contract questions are far cheaper to settle before the implementation than after it.

The [PR template](.github/PULL_REQUEST_TEMPLATE.md) has a checklist per change type. It is short
and it is not decorative.

## Review

Expect a first response within a couple of days. What review looks for, in order:

1. Does it break one of the seven rules above?
2. Is `docs/actions.md` updated if the contract changed?
3. Does the test run offline, and does it test behaviour rather than implementation?
4. Is there real personal data anywhere in the diff?
5. Is the tool or action description written for a model to read?
6. Is it the smallest change that solves the problem?

Review comments are about the code. If one reads as being about you, say so — it was written badly.

## Reporting security issues

Not in a public issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under the
[MIT Licence](LICENSE), same as the rest of the project.

## Conduct

[Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Short version: be decent, assume good faith, and
remember that the person on the other end is doing this in their spare time.
