# Release checklist — v2.0.0

The steps below are the ones **only Dominic can do**: they need GitHub, npm, PyPI or n8n
credentials, or a browser and a decision. Everything a machine can check has already been done and
is re-runnable in one command:

```bash
npm run release:check
```

That builds every workspace, regenerates `mcp-server/openapi.json` and `mcp-server/tools.json` and
fails if either moved, lints, runs the whole JavaScript test suite, installs `clients/python` into
a cached virtualenv and runs `pytest clients/python` (skipping with a message if there is no
Python 3.10+ or no network for pip), validates all 20 sequence templates, and writes
`dist/linkedin-toolkit-extension-v2.0.0.zip`. Do not start this list until it is green — and if the
Python step reported a skip on your machine, run it somewhere it does not before step 6.

## How to read the markers

| Marker | Meaning |
| --- | --- |
| ⚠️ **IRREVERSIBLE** | Cannot be undone. A published version is public forever; a deleted or renamed thing breaks links that already exist. Read the step twice. |
| ↩️ reversible | Can be undone with no lasting trace. |
| ⏳ | Blocks a later step — do it in order. |

Version numbers are already `2.0.0` in `extension/manifest.json`, `extension/package.json`,
`mcp-server/package.json`, `clients/node/package.json`, `clients/python/pyproject.toml` and
`clients/n8n/package.json`. Nothing below asks you to bump anything.

---

## 0. Before anything

- [ ] ↩️ `npm run release:check` is green on this machine.
- [ ] ↩️ The manual smoke run is recorded in `docs/smoke-results-2026-09.md` and committed —
      at minimum Part 1, the read-only path. See that file for what must not be run against a
      primary account.
- [ ] ↩️ `CHANGELOG.md`'s 2.0.0 entry matches what is actually shipping.
- [ ] ⚠️ **IRREVERSIBLE** Decide whether the demo GIF blocks launch (step 9). It is the single
      most-viewed asset in the repo, and the README currently shows a storyboard placeholder.
      Launching without it is a choice, not an oversight.

---

## 1. ⏳ Transfer the repository — ⚠️ **IRREVERSIBLE**

`OpenRecruiterTools/linkedin-toolkit` → `FormatixAI/linkedin-toolkit`.

This is first because every URL in the README, the docs, the changelog, the client packages and
the launch copy already points at `FormatixAI`. Until it happens, the published packages link to a
404.

GitHub UI path:

1. `https://github.com/OpenRecruiterTools/linkedin-toolkit` → **Settings**
2. Scroll to **Danger Zone** → **Transfer ownership** → **Transfer**
3. New owner: `FormatixAI`
4. Type the repository name to confirm.

Why irreversible in practice: GitHub redirects the old path, but the *old* organisation loses the
repo, forks re-point, any `git remote` still using the old URL keeps working only through the
redirect, and transferring back is a second transfer with the same consequences. Existing clones,
CI secrets and webhooks all need checking afterwards.

- [ ] ⚠️ Transfer done.
- [ ] ↩️ `git remote set-url origin https://github.com/FormatixAI/linkedin-toolkit.git` in every
      local clone and worktree.
- [ ] ↩️ Re-check repository **Settings → Secrets and variables → Actions**: the transfer keeps
      secrets, but confirm `NPM_TOKEN` is present before the tag is pushed, or the release
      workflow will build a release and silently skip the npm publish.

---

## 2. ⏳ Push the branch and open the PR — ↩️ reversible

```bash
cd D:\Projects\linkedin-toolkit
git push -u origin v2
gh pr create --base main --head v2 \
  --title "v2: agent-native, local-first LinkedIn toolkit" \
  --body-file docs/launch/blog-post.md
```

- [ ] ↩️ Pushed; CI is green on the PR (Node 20 + 22, Python 3.10 + 3.12, sequences, the
      no-headless-browser guard, the OpenAPI freshness check and the `better-sqlite3` load check).
- [ ] ↩️ Merge to `main` — **merge commit**, not squash. Fifty-odd commits across seven
      workstreams are the project's history, and squashing throws away the only record of why
      each decision was made.

If the default branch is still `master`, either rename it to `main` in Settings → Branches
(⚠️ **IRREVERSIBLE** for anyone with an existing clone) or change the `--base` above and the
branch names in `.github/workflows/ci.yml`. Do not do both.

---

## 3. ⏳ Tag — ⚠️ **IRREVERSIBLE** once pushed

```bash
git checkout main && git pull
git tag -a v2.0.0 -m "v2.0.0 — agent-native, local-first LinkedIn toolkit"
git push origin v2.0.0
```

A pushed tag is public and immutable in practice: people, package registries and release notes all
reference it. Deleting and re-pushing a moved tag breaks anyone who already fetched it. If
something is wrong, ship `v2.0.1`.

- [ ] ⚠️ Tagged and pushed.

---

## 4. GitHub Release — ⚠️ **IRREVERSIBLE** (the artefact is public)

Pushing the tag fires `.github/workflows/release.yml`, which lints, tests, validates the sequences,
builds `linkedin-toolkit-extension-v2.0.0.zip`, creates the release with generated notes and the
install block, and — if `NPM_TOKEN` is set — publishes `linkedin-toolkit-mcp`.

- [ ] ↩️ Watch the run: `gh run watch`
- [ ] ↩️ Check the release page has the zip attached and that its size is sane (~140 KB).
- [ ] ↩️ Download the zip, unzip it, and load it unpacked in a clean Chrome profile. This is the
      artefact real users get; nothing else in this checklist proves it works.

**If the workflow fails or you would rather do it by hand:**

```bash
npm run release:check          # produces dist/linkedin-toolkit-extension-v2.0.0.zip
gh release create v2.0.0 \
  dist/linkedin-toolkit-extension-v2.0.0.zip \
  --title "v2.0.0" \
  --notes-file docs/launch/release-notes.md   # or --generate-notes
```

- [ ] ⚠️ Release published.

---

## 5. npm — ⚠️ **IRREVERSIBLE**

A published version can be deprecated but **not** replaced, and unpublishing is only allowed
within 72 hours and only if nothing depends on it. Whatever goes up is what `npx` serves forever.

```bash
npm whoami                     # confirm the right account
npm publish -w mcp-server --access public       # linkedin-toolkit-mcp@2.0.0
npm publish -w clients/node --access public     # linkedin-toolkit@2.0.0
```

Dry-run each one first and read the file list — `files` in each `package.json` decides what ships,
and a missing `dist/` or a stray `node_modules/` is only visible here:

```bash
npm publish -w mcp-server --dry-run
npm publish -w clients/node --dry-run
```

- [ ] ↩️ Both dry runs list exactly what you expect.
- [ ] ⚠️ `linkedin-toolkit-mcp@2.0.0` published (skip if the release workflow already did it —
      check `npm view linkedin-toolkit-mcp version` first).
- [ ] ⚠️ `linkedin-toolkit@2.0.0` published.
- [ ] ↩️ Verify from a clean directory: `npx -y linkedin-toolkit-mcp --help` and
      `npx -y linkedin-toolkit-mcp serve --http --fake` both work with nothing installed.

---

## 6. PyPI — ⚠️ **IRREVERSIBLE**

PyPI never lets a version number be reused, even after deletion. Test on TestPyPI first.

```bash
cd clients/python
python -m pip install --upgrade build twine
rm -rf dist build *.egg-info
python -m build
twine check dist/*
twine upload --repository testpypi dist/*      # rehearsal
pip install -i https://test.pypi.org/simple/ linkedin-toolkit==2.0.0   # in a scratch venv
twine upload dist/*                            # ⚠️ the real one
```

- [ ] ↩️ `twine check` clean; TestPyPI install works.
- [ ] ⚠️ `linkedin-toolkit==2.0.0` published to PyPI.
- [ ] ↩️ `pip install linkedin-toolkit` in a fresh venv, then run the quickstart from
      `clients/python/README.md` against `lit serve --http --fake`.

---

## 7. n8n community node — ⚠️ **IRREVERSIBLE**

n8n's community node registry is npm: publishing the package is the submission.

```bash
cd clients/n8n
npm publish --access public                    # n8n-nodes-linkedin-toolkit@2.0.0
```

Then, so it appears in n8n's own directory:

- [ ] ⚠️ Published to npm.
- [ ] ↩️ Confirm `package.json` has the `n8n` block (`n8nNodesApiVersion`, `nodes`, `credentials`)
      and the `n8n-community-node-package` keyword — without it n8n will not list it.
- [ ] ↩️ Install it into a local n8n (`Settings → Community nodes → Install →
      n8n-nodes-linkedin-toolkit`) and run one workflow against `lit serve --http --fake`.
- [ ] ↩️ Submit for verification at https://docs.n8n.io/integrations/community-nodes/ if you want
      it available on n8n Cloud, not only self-hosted.

---

## 8. Seed the repository — ↩️ reversible

Fifteen scoped issues from `docs/launch/good-first-issues.md`. A repo with no open issues looks
finished, and a finished repo gets stars but no contributors.

Apply the labels first, or every `gh issue create` below fails on an unknown label:

```bash
gh workflow run labels.yml       # or: gh label create ... from .github/labels.yml
```

Then, one issue per file — split `docs/launch/good-first-issues.md` into `issue-01.md` …
`issue-15.md` (body only, no heading), and:

```bash
for f in issue-*.md; do
  title=$(head -1 "$f" | sed 's/^#* *//')
  gh issue create --title "$title" --body-file "$f" --label "good first issue"
done
```

Each issue's own section names its labels; add them per issue rather than blanket-applying
`good first issue` if you have the patience.

- [ ] ↩️ Labels applied.
- [ ] ↩️ 15 issues opened, each with the labels its section names.
- [ ] ↩️ **Discussions enabled**: Settings → General → Features → tick **Discussions**. Create the
      categories: Q&A, Ideas, Show and tell, Endpoint reports.
- [ ] ↩️ **Topics added**: Settings → the gear beside "About" → Topics:
      `linkedin`, `mcp`, `mcp-server`, `chrome-extension`, `ai-agents`, `automation`,
      `recruiting`, `sales`, `lead-generation`, `model-context-protocol`, `claude`,
      `local-first`.
- [ ] ↩️ **About** box: the one-liner from `docs/launch/directories.md` and the repo's own URL.
- [ ] ↩️ Releases, Packages and Environments hidden or shown as you want them in the sidebar.

---

## 9. The demo GIF — ↩️ reversible

`docs/launch/record-demo.md` has the four-beat storyboard, the recording setup and the compression
settings. Record against `lit serve --fake` rather than a real account: it produces real envelopes,
real error codes and invented people, and nothing touches LinkedIn.

- [ ] ↩️ `docs/assets/demo.gif` recorded — 30 s, ≤ 8 MB, 1200 px wide, and beat 4 (the human
      approving from the Queue tab) is in it. Beat 4 is the whole argument.
- [ ] ↩️ README image reference changed from `docs/assets/demo-storyboard.png` to
      `docs/assets/demo.gif`, and the storyboard PNG deleted.
- [ ] ↩️ Committed and pushed to `main`.

---

## 10. Directory submissions — ↩️ reversible (mostly)

Work through `docs/launch/directories.md` in its own order; the MCP registries are worth the most
per unit of effort. Do not start before step 5 — several of them auto-scan the npm package, and a
listing created against a missing package is worse than no listing.

- [ ] ↩️ Smithery, Glama, PulseMCP, mcp.so, MCP Market
- [ ] ↩️ Official MCP registry (PR)
- [ ] ↩️ Cursor directory (PR)
- [ ] ↩️ awesome-mcp-servers, both lists (PR each, the exact line is in the doc)
- [ ] ↩️ The remaining sections of `docs/launch/directories.md`

---

## 11. Announce — ⚠️ **IRREVERSIBLE** in the sense that attention is spent once

Copy is written and waiting: `docs/launch/show-hn.md`, `product-hunt.md`, `reddit-posts.md`,
`linkedin-post.md`, `blog-post.md`.

Do not post any of it until steps 1–6 are done and you have loaded the released zip in a clean
Chrome profile yourself. A launch thread that peaks while the install is broken does not get a
second run.

- [ ] ↩️ Show HN
- [ ] ↩️ Product Hunt
- [ ] ↩️ The subreddits named in `reddit-posts.md`, spaced out, not all in one day
- [ ] ↩️ LinkedIn post — from the account you are willing to post from, given the subject matter

---

## After

- [ ] ↩️ Watch the first issues. The Voyager endpoints in `docs/smoke-results-2026-09.md` Part 3
      are the likeliest thing to break in the wild, and a user with a broken one will paste a
      response shape into an issue. That shape is the fix.
- [ ] ↩️ Open a `## [Unreleased]` section in `CHANGELOG.md` on the first change after the tag.
