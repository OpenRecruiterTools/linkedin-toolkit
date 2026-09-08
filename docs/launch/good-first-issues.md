# Good first issues

Fifteen issues to open before launch. A repo with no open issues looks finished, and a finished
repo gets stars but no contributors.

Each is scoped to one afternoon, has a clear definition of done, and names the files to touch —
which is the difference between an issue someone picks up and one that sits for a year.

Create them with:

```bash
gh issue create --title "..." --body-file issue-01.md --label "good first issue,extractor"
```

Labels come from [`.github/labels.yml`](../../.github/labels.yml). Apply them with the
`labels` workflow before opening any of these.

---

## 1. Add a `company.followers` extractor

**Labels:** `good first issue`, `extractor`, `help wanted`

> Followers of a company page are a strong intent list — they opted in to hearing from that
> company. We have `company.employees` but not `company.followers`.
>
> **The endpoint:** open a company page while logged in, DevTools → Network → filter `voyager`,
> click "See all followers". You are looking for `/voyager/api/organization/...` with `start` and
> `count` parameters.
>
> **Files to touch** (the guide is [docs/build-an-extractor.md](../build-an-extractor.md)):
> - `docs/actions.md` — add the action row **first**
> - `extension/src/lib/actions.js` — action name + `validateParams`
> - `extension/src/background/voyager.js` — the extractor, reusing `voyagerFetch`
> - `mcp-server/src/contract.ts` and `src/tools.ts` — zod schema + `linkedin_get_company_followers`
> - `extension/tests/` — a test against an **anonymised** fixture
> - `docs/tools.md` — a row
>
> **Done when:** paged results return `Profile[]` with `nextStart`, the quota bucket is `search`
> charged per result, and the test passes offline.
>
> Ask in the issue if you are unsure about the result shape — that is much cheaper to settle before
> you write it.

## 2. Add a `hashtag.followers` extractor

**Labels:** `good first issue`, `extractor`, `help wanted`

> Everyone following a hashtag is a self-selected audience for that topic — the best cold list you
> can build for a niche.
>
> Same shape as #1: find the Voyager call behind a hashtag page's follower list, add the action,
> the extractor, the tool and a test. `search` quota, charged per result.
>
> **Done when:** `linkedin_get_hashtag_followers` returns paged `Profile[]` and there is an
> offline test.

## 3. Add a `profile.recommendations` extractor

**Labels:** `good first issue`, `extractor`, `help wanted`

> Recommendations given and received are the highest-signal free text on a profile — someone wrote
> them by hand about this specific person. They would make Research Pack dossiers considerably
> better.
>
> Needs a new shared type. Propose it in the issue before implementing:
>
> ```ts
> type Recommendation = { fromPublicId, fromName, fromHeadline, text, relationship, givenAt };
> ```
>
> **Done when:** `profile.recommendations` returns both directions, the type is in `docs/actions.md`,
> and there is an offline test.

## 4. Five more sequence templates

**Labels:** `good first issue`, `sequences`, `documentation`

> We ship 20. There is room for many more, and this needs no JavaScript at all — just judgement
> about outreach.
>
> Wanted, roughly in order of demand:
> - **Open-source maintainer to contributor** — someone starred or forked your repo
> - **Alumni outreach** — same school or same former employer
> - **Customer to case study** — asking a happy customer to go on the record
> - **Conference speaker follow-up** — you watched their talk
> - **Dormant customer win-back** — churned six months ago
>
> Copy `sequences/warm-connect.json`, change the copy, then:
>
> ```bash
> node sequences/validate.mjs
> ```
>
> **Rules the validator enforces:** exactly two variants per invite and message step, 300-character
> ceiling, a `|fallback` on every variable, at least 24h between outreach steps, a branch,
> `stopOnReply: true`, `autopilot: false`.
>
> **Rules review enforces:** copy a real person would actually send. Nothing from the ban list in
> `sequences/README.md`.
>
> **Done when:** the files validate and the table in `sequences/README.md` is updated.

## 5. Firefox support for the extension

**Labels:** `help wanted`, `extension`, `enhancement`

> The extension is MV3 and mostly portable. Firefox supports MV3 with differences that need
> working through rather than around.
>
> **The real work:**
> - `background.service_worker` vs Firefox's `background.scripts`
> - The service worker lifecycle — our WebSocket keep-alive assumption is Chrome-specific
>   (Chrome 116+ keeps the worker alive while a socket is open)
> - `browser.*` promises vs `chrome.*` callbacks (a thin polyfill is probably enough)
> - `chrome.storage.local` quotas and IndexedDB behaviour differ
>
> Start with a report in the issue: what actually breaks when you load it in Firefox. That triage
> is genuinely useful even if you go no further.
>
> **Done when:** the extension loads in Firefox, the bridge stays connected through an idle period,
> and a search returns results.

## 6. Sequence step preview in the popup

**Labels:** `good first issue`, `extension`, `ux`

> When you build a sequence you cannot see what it will look like to a real person. You should be
> able to pick someone from the enrolled list and see every message rendered with their actual
> details, both variants, with character counts.
>
> **Files:** `extension/src/popup/popup.js`, `popup.html`, `popup.css`, and
> `extension/src/lib/template.js` (which already does the rendering).
>
> **Done when:** the Campaigns tab has a Preview button, it renders each step for a chosen enrollee,
> character counts show, and anything over 300 is flagged red.

## 7. `docs/actions.md` → JSON Schema generator

**Labels:** `good first issue`, `tooling`, `documentation`

> The contract lives in a markdown table. The zod schemas in `mcp-server/src/contract.ts` mirror it
> by hand, which will drift.
>
> Write a script that parses the action table and emits JSON Schema per action, plus a test that
> fails when the two disagree.
>
> **Files:** `scripts/gen-schemas.mjs`, a test in `mcp-server/tests/`, a CI step.
>
> **Done when:** CI fails if someone adds an action to `docs/actions.md` without a schema, or
> changes a schema without the doc.

## 8. Ollama prompt tuning for openers

**Labels:** `good first issue`, `ai`, `help wanted`

> The BYOK layer supports Ollama, so the whole pipeline can run locally. But an 8B model writes
> noticeably worse openers than a frontier model, and the current prompt is written for the latter.
>
> **The task:** build a small eval set (20 profiles, synthetic), write an Ollama-specific prompt in
> `extension/src/background/ai.js`, and show before-and-after. Smaller models generally need more
> structure, fewer instructions at once, and a concrete example.
>
> **Done when:** a documented prompt, an eval set in the repo, and honest output samples in the PR —
> including the ones that are still bad.

## 9. Per-variant campaign stats

**Labels:** `good first issue`, `extension`, `analytics`

> Every message step ships with two variants and the engine picks one per enrollee — but the stats
> only aggregate. You cannot see which variant won, which is the entire reason to A/B.
>
> **Files:** `extension/src/background/campaigns.js` (record the variant index on send),
> `docs/actions.md` (extend `stats.byStep`), the Campaigns tab in the popup.
>
> **Done when:** `campaign.get` returns per-variant sent/accepted/replied, the popup shows them side
> by side, and it is honest about small samples — six sends is not a winner.

## 10. `lit doctor` diagnostic command

**Labels:** `good first issue`, `cli`, `ux`

> Most support questions are one of five things. A single command should answer all of them.
>
> Check and report: Node version ≥ 20; config file present and readable; bridge port free or bound
> by us; extension connected and its version; LinkedIn logged in; quota state; SQLite file present
> and writable; webhook URL reachable if set.
>
> Print each with a ✓ or ✗ and a one-line fix for every failure.
>
> **Files:** `mcp-server/src/cli.ts`, a snapshot test.
>
> **Done when:** `lit doctor` gives an actionable answer for each of the five most common failures.

## 11. Mastra integration wrapper

**Labels:** `good first issue`, `integration`, `help wanted`

> Mastra is a TypeScript agent framework with a growing user base and no LinkedIn tooling.
>
> Follow the shape of the existing wrappers in `clients/node/`: export a `mastraTools()` that
> returns the tool definitions in Mastra's format, plus a smoke test that registers them and calls
> `linkedin_get_status` against the fake bridge.
>
> **Also needed:** `docs/agents/mastra.md` with the config block, and an
> `examples/mastra/` folder.
>
> **Done when:** `npm i linkedin-toolkit` gives a Mastra user working tools in three lines.

## 12. Structured logging with a redaction pass

**Labels:** `good first issue`, `mcp-server`, `enhancement`

> Debugging the bridge currently means `console.log`. Worse, a naive log of a request body writes
> real people's names and message text to disk.
>
> Add levelled logging (`--log-level`, `LINKEDIN_TOOLKIT_LOG` env var) writing JSON lines to
> `~/.linkedin-toolkit/logs/`, with a **redaction pass** that strips profile fields and message
> bodies unless `--log-level trace` is explicitly set.
>
> **Files:** `mcp-server/src/log.ts` (new), used from `bridge.ts`, `http.ts`, `cli.ts`.
>
> **Done when:** logs are useful for debugging, rotate, and never contain personal data at the
> default level.

## 13. Import a list from a Sales Navigator saved search

**Labels:** `good first issue`, `extractor`, `enhancement`

> `search.people` accepts `source: "salesnav"`, but Sales Navigator's *saved searches* — where the
> filters actually live — are not reachable. Users end up re-typing filters that already exist.
>
> Find the Voyager endpoint behind the saved-search list and behind running one, then add
> `salesnav.savedSearches` and `salesnav.runSavedSearch`.
>
> Requires a Sales Navigator seat to develop against, so say so in the issue if you have one.
>
> **Done when:** saved searches can be listed and run into a list, and the tool description states
> plainly that it needs a Sales Navigator seat.

## 14. Accessibility pass on the popup

**Labels:** `good first issue`, `extension`, `accessibility`, `help wanted`

> The popup has never been audited. It is the primary interface and it is the place a human
> approves messages, so it needs to work with a keyboard and a screen reader.
>
> **The work:** keyboard navigation through every tab and the queue; visible focus states; ARIA
> labels on icon-only buttons; contrast at WCAG AA on both themes; `aria-live` on the queue count
> and status dot; `prefers-reduced-motion` respected.
>
> **Files:** `extension/src/popup/*`, `extension/src/options/*`.
>
> **Done when:** the queue can be approved end to end with a keyboard alone, axe reports no
> criticals, and the PR says what was tested with which screen reader.

## 15. Contract test suite the clients share

**Labels:** `good first issue`, `testing`, `help wanted`

> The Node client, the Python client and the n8n node each independently claim to speak the action
> contract. Nothing checks that they agree.
>
> Write a language-neutral fixture set — request and expected response per action, as JSON — plus a
> runner in each client that plays them against the fake bridge.
>
> **Files:** `tests/contract/*.json` (new, shared), runners in `clients/node/tests/` and
> `clients/python/tests/`, a CI job.
>
> **Done when:** adding an action to `docs/actions.md` without adding a fixture fails CI, and a
> client that mis-serialises a parameter fails its own suite.

---

## Labelling

Every issue above needs `good first issue` plus at least one topic label. `help wanted` goes on the
ones that need someone with something we do not have — a Sales Navigator seat, a screen reader,
Firefox on a machine they use daily.

Then, before launch:

- Pin two or three so they are the first thing a visitor sees under Issues
- Enable Discussions
- Put the [build-an-extractor guide](../build-an-extractor.md) link in the repo description
- Answer within 24 hours. A first-time contributor who waits three days does not come back.
