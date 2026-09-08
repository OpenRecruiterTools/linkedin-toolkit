# Voyager endpoints

Every LinkedIn call the engine makes is listed here. The table in the code is
`ENDPOINTS` in [`extension/src/background/voyager.js`](../extension/src/background/voyager.js);
this file is its documentation, and the two are meant to be edited together.

**Captured 2026-09-08 against LinkedIn web client `1.13.46474` (Chrome 153).**
The same two values live in `voyager.CAPTURED` so a running build can report
what it was built against.

## How this works at all

The toolkit is not a browser bot. It runs in the user's own signed-in Chrome
and calls the same private API the LinkedIn web app calls, with the same
cookies. Every request carries:

| Header | Value |
| --- | --- |
| `csrf-token` | the `JSESSIONID` cookie value, quotes stripped |
| `x-restli-protocol-version` | `2.0.0` |
| `accept` | `application/vnd.linkedin.normalized+json+2.1` |
| `x-li-lang` | `en_US` |

That `accept` header is what makes the responses *normalized*: the body is
`{ data, included }`, where `data` holds paging plus references
(`"*elements": ["urn:li:fsd_profile:…"]`) and `included` holds the entities,
each with a `$type` and an `entityUrn`. Nothing can be read by walking the body
alone — [`normalized.js`](../extension/src/background/normalized.js) does the
dereferencing, and every normalizer goes through it.

Most reads are no longer REST paths. They are **persisted GraphQL queries**:

```
GET /voyager/api/graphql?includeWebMetadata=true&variables=(…)&queryId=<name>.<32 hex>
```

`variables` is Rest.li 2.0 syntax, not JSON and not form encoding:
`(key:value,list:List(a,b),nested:(k:v))`. `(`, `)`, `,` and `:` are the
syntax; **inside a value they are percent-encoded like everything else**, so a
urn goes on the wire as `urn%3Ali%3Aactivity%3A7501…` and a space as `%20`.
Leaving the colons literal is accepted by search and answered with a 400 by
`voyagerSocialDashReactions` and the whole messaging surface, so there is one
rule and no exceptions. `encodeVariables()` in `voyager-core.js` is the only
place that is implemented, and it is unit-tested against the byte-exact URL of
a verified probe.

`includeWebMetadata=true` is **not** sent. The web app puts it on some queries
and not others, and the ones that do not want it answer 400; the helper takes
it as an opt-in flag and nothing currently opts in.

Messaging has its own surface at `/voyager/api/voyagerMessagingGraphQL/graphql`,
which puts `queryId` first and addresses every call to a mailbox — the mailbox
is us, so `/voyager/api/me` is read once per session for our own urn.

## Verified

Each of these returned HTTP 200 with real data on the capture date.

| Engine key | Request | Backs |
| --- | --- | --- |
| `me` | `GET /voyager/api/me` | `voyager.selfTest()`, the messaging mailbox urn |
| `profiles` + `decorations.topCard` | `GET /identity/dash/profiles?q=memberIdentity&memberIdentity=<vanity>&decorationId=…WebTopCardCore-19` | `profile.get`, every metered profile read. **The only endpoint that still states the connection degree**, through the included `MemberRelationship` |
| `profiles` + `decorations.fullProfile` | same, `decorationId=…FullProfile-76` | `profile.get { full: true }` — adds summary and industry |
| `queryIds.profileComponents` | `variables=(profileUrn:<urn>,sectionType:experience,locale:en_US)` | `Profile.experience` (and `education`, `skills` on a full read) |
| `queryIds.searchClusters` | `variables=(start,count,origin,query:(keywords,flagshipSearchIntent:SEARCH_SRP,queryParameters:List(…),includeFiltersInResponse:false))` | `search.people`, `company.employees`, `network.followers`, mutual connections |
| `companies` | `GET /organization/companies?decorationId=…WebFullCompanyMain-12&q=universalName&universalName=<name>` | `company.get` — the read that actually answers with a company |
| `queryIds.company` | `variables=(universalName:<name>)` | the fallback for the row above, and the id lookup `company.employees` needs |
| `queryIds.reactions` | `variables=(threadUrn:<urn:li:activity:…>,count,start)` | `post.engagers { kind: 'likes' }` |
| `connections` | `GET /relationships/dash/connections?decorationId=…ConnectionListWithProfile-16&q=search&sortType=RECENTLY_ADDED&start&count` | `network.connections` |
| `sentInvitations` | `GET /relationships/sentInvitationViewsV2?q=invitationType&invitationType=CONNECTION&start&count` | `network.status`, the campaign `accepted` branch, the already-connected pre-check |
| `queryIds.sentInvitations` | `variables=(start,count,invitationType:CONNECTION)` | fallback for the row above |
| `queryIds.conversations` | messaging: `variables=(categories:List(INBOX,SPAM,ARCHIVE),count,firstDegreeConnections:false,mailboxUrn:<self>,read:false)` | `inbox.threads`, reply detection |
| `queryIds.conversationsByCategory` | messaging: `variables=(query:(predicateUnions:List((conversationCategoryPredicate:(category:INBOX)))),count,mailboxUrn:<self>,lastUpdatedBefore:<ms>)` | paging back through the inbox |
| `queryIds.messages` | messaging: `variables=(deliveredAt:<ms>,conversationUrn:<urn>,countBefore:<n>,countAfter:0)` | `inbox.messages` |
| `queryIds.memberPosts` | `variables=(count,start,profileUrn:<urn>,paginationToken?)` | `research.pack`'s `recentPosts` |

### What these endpoints do *not* give us

- **`queryIds.positions`** (`voyagerIdentityDashProfilePositions`) answers 200,
  but every `Position` it returns is a urn plus a `*company` reference — no
  title, no dates, no description. It is in the table for the record; the
  engine reads experience from `profileComponents` instead, which does carry
  the rendered title, employer and date range.
- The **company GraphQL** query answers with a thin decoration for some
  organisations — for `microsoft` on the capture date it returned nothing but
  the `entityUrn`. That is why `company.get` reads REST first and keeps GraphQL
  as the fallback: the urn alone is still enough for an employee search.
  Note the two surfaces spell the urn differently,
  `urn:li:fs_normalized_company:1035` and `urn:li:fsd_company:1035`.
- The **messaging surface is fussy** in a way the rest of Voyager is not. It
  rejects `includeWebMetadata`, and each query wants its variables by exactly
  the right names in exactly the right order.
- **No decoration carries the member photo** for anybody but ourselves — the
  top card and the full profile both return a `profilePicture` with only
  `a11yText`. The connections list and search results do carry it, so a profile
  read returns the *stored* record, which keeps a photo an earlier read found;
  `profile.get { full: true }` also captures one from the page.
- **Followers** come back through the search surface, and their navigation urls
  carry the obfuscated member id rather than a vanity name, so `publicId` is
  that id. It is still a working profile URL and a stable key.
- **`title` and `location` are not search facets.** `(key:title,…)` is
  rejected outright, and turning a place name into a `geoUrn` needs a typeahead
  call this build does not make, so both are appended to `keywords` — which is
  what the web app's own search box does. `company` *is* resolved to the real
  `currentCompany` facet when it looks like a universal name.

## Unverified

Nothing below has been confirmed against the current client. Each is isolated
in `ENDPOINTS.unverified`, and every call through it is wrapped so that an
unrecognised response surfaces as `LINKEDIN_ERROR` with

> `This endpoint has not been verified against the current LinkedIn client; see docs/voyager-endpoints.md`

rather than as raw LinkedIn JSON or a silently empty list. A `NOT_LOGGED_IN`,
`RATE_LIMITED` or `CHALLENGE_DETECTED` still passes through untouched, because
those are things the user has to act on.

| Engine key | Why it is unverified |
| --- | --- |
| `comments` | `feed/comments?q=comments` answered 400 on the capture date. `voyagerSocialDashComments` hashes exist in the bundle (`b36758ed…`, `cfb1d574…`, `92a1e475…`, `bde6a995…`) but the variable shape has not been worked out. `post.engagers { kind: 'comments' }` therefore fails honestly; `kind: 'both'` returns the reactions it did read and names `comments` in `unavailable` |
| `groupMemberships` | the capture account belongs to no groups |
| `eventAttendees` | no event was available to read |
| `salesNavSearch`, `recruiterSearch` | no Sales Navigator or Recruiter seat on the capture account |
| `followingStates` | `outreach.follow`. A write; not probed |
| `createInvitation` | `voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2`. A write; not probed |
| `createMessage` | `voyagerMessagingDashMessengerMessages?action=createMessage`. A write; not probed |
| `createReaction`, `createComment` | `outreach.like`, `outreach.comment`. Writes; not probed |

Writes are not probed on principle: probing a write means sending something to
a real person. They stay guesses until the owner approves a live send from a
throwaway account.

The fixtures for the unverified endpoints
(`groupMembers.json`, `eventAttendees.json`, `comments.json`,
`salesNavSearch.json`, `recruiterSearch.json`) are hand-written from the shapes
these endpoints used to return. They prove the normalizers still work if such a
body arrives; they are **not** evidence that it does. Every other fixture under
`extension/tests/fixtures/voyager/` is derived from a real 2026-09-08 capture,
with names, ids and text replaced by fictional ones.

## Removed

These were in the engine and are gone: they answered an error on every call.

| Path | Status |
| --- | --- |
| `identity/profiles/{id}/profileView` | 410 |
| `search/dash/clusters` (REST) | 500 |
| `messaging/conversations?keyVersion=LEGACY_INBOX` | 500 |
| `growth/normInvitations` | 400 |
| `relationships/invitationViews?q=sentInvitation` | 400 |
| `feed/reactions?q=reactionType` | 400 |
| `identity/profileUpdatesV2` | 400 |
| `feed/dash/followingStates?ids=` | 400 (the `toggleFollow` write on the same path is kept, unverified) |
| `identity/dash/profilePositionGroups` | 400 |
| `identity/dash/profileFollowers?q=followersOfViewer` | replaced by the curation-hub search |

## How query IDs are discovered

A `queryId` is a persisted-query hash. It is a literal string in LinkedIn's own
JavaScript bundles, matching

```
/(voyager|messenger)[A-Za-z]+\.[0-9a-f]{32}/
```

and it sits next to the query name it belongs to, which is also the key the
response is returned under (`voyagerSearchDashClusters.…` →
`data.data.searchDashClustersByAll`). LinkedIn ships new bundles regularly and
a stale id answers **400**, so this is the first thing to check when a working
feature starts failing.

### Re-capturing from DevTools

1. Sign in to linkedin.com in a normal Chrome profile.
2. Open DevTools → **Network**, and filter on `voyager/api`.
3. Drive the feature you want in the LinkedIn UI — run a search, open a
   profile, scroll the reactions dialog on a post.
4. Find the request, and copy the `queryId` and the whole `variables=(…)`
   string out of the URL.
5. Right-click → **Copy → Copy response** to keep the body; that is what a
   fixture is derived from.
6. Update the matching entry in `ENDPOINTS.queryIds`, the row in the table
   above, and the capture date in `CAPTURED`. Re-run `npm test -w extension`.

Decoration ids (`…FullProfile-76`, `…WebTopCardCore-19`,
`…ConnectionListWithProfile-16`) are captured the same way and version
independently of the query ids — the trailing number changes when LinkedIn
changes the shape.

### Checking them without DevTools

`voyager.selfTest()` answers "is this session usable, and who is it?" from one
unmetered `/voyager/api/me` call.

`status.get { verify: true }` runs the whole read-only pass — one minimal call
per verified endpoint — and returns

```jsonc
{
  "endpoints": { "me": "ok", "search": "ok", "company": "failed", "comments": "unverified", … },
  "clientVersionCaptured": "1.13.46474",
  "endpointsCapturedAt": "2026-09-08",
  "endpointErrors": { "company": "Voyager API error 400: …" }
}
```

Pass `postUrl` alongside it to include the reactions check; without one that
row reads `skipped`. The search and the profile read it makes are metered
exactly as the real actions are (one search result, one visit) so the check
cannot be used to get around the caps; everything else it touches is free.
Unverified endpoints are reported as `unverified` and are never called.

This is what the `lit endpoints check` CLI command runs.
