# Build an extractor

Adding a new data source is the best first contribution to this repo. It touches four files, has a
clear test, and every one you add makes the toolkit more useful to everybody.

An "extractor" is one Voyager endpoint turned into a typed action: company followers, saved
articles, skill endorsements, recommendations, newsletter subscribers, hashtag followers, job
applicants. Anything the LinkedIn web app can show you, it fetched from somewhere.

## The four files

| File | What you add |
|---|---|
| `docs/actions.md` | A row in the action table, and any new type. **This first — the contract is the source of truth.** |
| `extension/src/lib/actions.js` | The action name in `ACTIONS`, and a `validateParams` branch. |
| `extension/src/background/voyager.js` | The fetch, the pagination, and the normalisation to a shared type. |
| `mcp-server/src/contract.ts` + `src/tools.ts` | The zod schema and the `linkedin_*` tool. |

Plus a test in `extension/tests/` against a recorded fixture, and a line in `docs/tools.md`.

## 1. Find the endpoint

Open the LinkedIn page that shows the data. DevTools → Network → filter `voyager`. Do the thing by
hand — click "see all followers", scroll the list, open the tab. Watch what fires.

You are looking for a request to `/voyager/api/…` that returns JSON containing what you want. Note:

- the **path** and its query parameters,
- how **pagination** works — usually `start` and `count`, sometimes an opaque cursor,
- which **headers** the page sends: `csrf-token` (the `JSESSIONID` cookie value with quotes
  stripped), `x-restli-protocol-version: 2.0.0`, and often an `x-li-lang`,
- the **shape** of the response, which is usually a flat `elements` array plus an `included` array
  that everything else references by URN.

Right-click → Copy as fetch is the fastest way to get a working call you can iterate on in the
console — from a LinkedIn tab, so the cookies come along.

**Two rules while you are in here.** Only use endpoints the page itself calls, on data you can
already see while logged in. And do not go looking for endpoints that return data LinkedIn does
not show you — that is a different project and not one this repo will merge.

## 2. Write the contract first

Add the row to `docs/actions.md`:

```markdown
| `company.followers` | `{ universalName, start?, count? }` | `{ profiles: Profile[], nextStart? }` |
```

Reuse an existing type if you possibly can. `Profile`, `Company`, `Engager`, `Thread` and
`Message` cover most things, and a result that is "a list of people" should be `Profile[]` even if
the endpoint returns something richer — put the extra fields on the profile rather than inventing
a parallel type. Every new type is a thing five other files have to learn.

Pagination is `start` / `count` with `nextStart` in the result, `null` when exhausted. Keep it
that way even if the endpoint uses a cursor; translate inside the extractor.

## 3. The extension side

`extension/src/lib/actions.js`:

```js
export const ACTIONS = {
  // …
  COMPANY_FOLLOWERS: 'company.followers',
};

// in validateParams()
case ACTIONS.COMPANY_FOLLOWERS:
  requireString(params, 'universalName');
  optionalInt(params, 'start', 0);
  optionalInt(params, 'count', 1, 100);
  return;
```

`extension/src/background/voyager.js`:

```js
/**
 * Followers of a company.
 * GET /voyager/api/organization/followers?q=organization&organization={urn}&start=&count=
 */
export async function getCompanyFollowers({ universalName, start = 0, count = 50 }) {
  const org = await getCompany({ universalName });          // reuse: we need the URN
  const url = new URL('https://www.linkedin.com/voyager/api/organization/followers');
  url.searchParams.set('q', 'organization');
  url.searchParams.set('organization', org.urn);
  url.searchParams.set('start', String(start));
  url.searchParams.set('count', String(Math.min(count, 100)));

  const json = await voyagerFetch(url);                     // adds csrf-token, restli headers, handles 429/451
  const profiles = (json.elements ?? [])
    .map((el) => normaliseProfile(resolveIncluded(json, el.follower)))
    .filter(Boolean);

  return {
    profiles,
    nextStart: profiles.length === count ? start + count : null,
  };
}
```

Things `voyagerFetch` already does for you, so do not reimplement them: the CSRF header, the
restli protocol header, 429 → backoff and `RATE_LIMITED`, 451 → global write pause and
`CHALLENGE_DETECTED`, and the human delay before the request.

Wire it into `engine.js`:

```js
case ACTIONS.COMPANY_FOLLOWERS:
  await quota.consume('search', params.count ?? 50);   // pick the right quota bucket
  return voyager.getCompanyFollowers(params);
```

**Choosing a quota bucket** is a real decision, not a formality. Reading a list of people is
`search`. Loading one full profile is `visit`. Anything that writes is `invite` or `message`. If
your extractor does one request that returns 100 people, charge 100 to `search`, not 1 — the caps
exist to model what LinkedIn sees, and LinkedIn saw 100 profiles go past.

## 4. The MCP side

`mcp-server/src/contract.ts`:

```ts
export const companyFollowersParams = z.object({
  universalName: z.string(),
  start: z.number().int().min(0).optional(),
  count: z.number().int().min(1).max(100).optional(),
});
```

`mcp-server/src/tools.ts`:

```ts
{
  name: 'linkedin_get_company_followers',
  description:
    'Everyone following a company page. Paged: pass the returned nextStart as start. Each result ' +
    'spends search quota from the daily cap of 1,000.',
  inputSchema: companyFollowersParams,
  handler: (params) => bridge.call('company.followers', params),
}
```

The description is not documentation, it is a prompt — it is the only thing the model reads before
deciding whether to call your tool. Say what it returns, say what it costs, and say anything that
would make a model misuse it. Compare:

- ✗ "Gets company followers."
- ✓ "Everyone following a company page. Paged: pass the returned nextStart as start. Each result
  spends search quota from the daily cap of 1,000."

## 5. Test it, offline

Record a fixture — the raw JSON from DevTools, **with the personal data replaced**. Do not commit
real people's names, URNs, or photos.

```js
// extension/tests/voyager.company-followers.test.js
import { describe, it, expect, vi } from 'vitest';
import fixture from './fixtures/company-followers.json';
import { getCompanyFollowers } from '../src/background/voyager.js';

describe('company.followers', () => {
  it('normalises elements into profiles', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fixture });

    const result = await getCompanyFollowers({ universalName: 'example-co', count: 50 });

    expect(result.profiles).toHaveLength(50);
    expect(result.profiles[0]).toMatchObject({
      publicId: expect.any(String),
      fullName: expect.any(String),
      url: expect.stringContaining('linkedin.com/in/'),
    });
    expect(result.nextStart).toBe(50);
  });

  it('returns nextStart null on a short page', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ...fixture, elements: fixture.elements.slice(0, 7) }),
    });
    expect((await getCompanyFollowers({ universalName: 'example-co', count: 50 })).nextStart).toBeNull();
  });
});
```

No test in this repo makes a live LinkedIn call, and no test uses a real browser. Both are
enforced in review.

## 6. Document it

- A row in [`tools.md`](tools.md).
- A line in the README feature grid if it is a headline capability.
- If it needs Sales Navigator or Recruiter, say so in the tool description **and** the docs. A tool
  that fails only for free accounts, silently, is worse than one that does not exist.

## Endpoints worth adding

Open issues exist for several of these — see
[good first issues](https://github.com/FormatixAI/linkedin-toolkit/labels/good%20first%20issue).

| Extractor | Action | Notes |
|---|---|---|
| Company followers | `company.followers` | Straightforward, well-defined pagination |
| Hashtag followers | `hashtag.followers` | Good intent signal for a niche |
| Newsletter subscribers | `newsletter.subscribers` | Your own newsletter only |
| Post commenters, threaded | `post.comments` | Replies as well as top-level |
| Recommendations | `profile.recommendations` | Given and received |
| Skill endorsements | `profile.endorsements` | Who endorsed whom — a relationship graph |
| Job posting applicants | `job.applicants` | Recruiter seat only; must be documented as such |
| Saved posts and articles | `saved.items` | Your own saves |
| Company job postings | `company.jobs` | Feeds the hiring signal in Research Pack |
| Alumni search | `school.alumni` | Powerful for sourcing, awkward pagination |

## Checklist for the PR

- [ ] `docs/actions.md` updated first, with the action row and any new type
- [ ] Action name in `ACTIONS`, params validated in `validateParams`
- [ ] Extractor reuses `voyagerFetch`, does not reimplement CSRF, backoff, or delay
- [ ] Correct quota bucket, charged per **result**, not per request
- [ ] Result reuses an existing shared type where it can
- [ ] `nextStart` pagination, `null` when exhausted
- [ ] zod schema and MCP tool with a description that states cost and pagination
- [ ] Vitest test against an **anonymised** fixture, offline
- [ ] Row in `docs/tools.md`
- [ ] No live calls, no headless browser, no real personal data in fixtures

Open a draft PR early if you are unsure about the shape. Contract questions are much cheaper to
answer before the implementation than after it.
