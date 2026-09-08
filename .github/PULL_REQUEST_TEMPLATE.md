## What and why

<!-- One paragraph. What changes, and what problem it solves. Link the issue: Closes #123 -->

## How to check it

<!-- The commands a reviewer runs, or the steps they click through. -->

```bash
npm test
node sequences/validate.mjs
```

## Checklist

- [ ] Tests pass locally (`npm test`) and lint is clean (`npm run lint`)
- [ ] New behaviour has a test, and it runs **offline** — no live LinkedIn calls anywhere
- [ ] No real personal data in fixtures, tests, screenshots, or the PR description
- [ ] No Playwright, Puppeteer, CDP, or any headless browser
- [ ] No hosted service, backend, or shared state between users
- [ ] Hard caps, the approval queue and the challenge pause are untouched, or the change to them
      is the explicit point of the PR and is argued for above

### If you changed the contract

- [ ] `docs/actions.md` updated **first** — it is the source of truth
- [ ] `extension/src/lib/actions.js` — action name and `validateParams`
- [ ] `mcp-server/src/contract.ts` and `src/tools.ts` — zod schema and tool
- [ ] The tool description states what it returns **and what it costs in quota**
- [ ] `docs/tools.md` updated

### If you added an extractor

- [ ] Reuses `voyagerFetch` — no reimplemented CSRF header, backoff, or delay
- [ ] Charges the right quota bucket, per **result** rather than per request
- [ ] Reuses an existing shared type where it can
- [ ] `nextStart` pagination, `null` when exhausted
- [ ] Documented if it needs a Premium, Sales Navigator or Recruiter seat

### If you added a sequence

- [ ] `node sequences/validate.mjs` passes
- [ ] Copy you would actually press send on, and nothing from the ban list in
      `sequences/README.md`
- [ ] The table in `sequences/README.md` updated

### If you added a skill

- [ ] `description` carries the phrases a real user would type
- [ ] Steps name the exact tools and argument shapes
- [ ] Guardrails cover facts-only, the caps, and Copilot mode

## Anything a reviewer should know

<!-- Trade-offs, things you were unsure about, things you deliberately left out. -->
