# Smoke run — September 2026 (v2.0.0)

> **This template is not a result.** Every Result cell below is empty on purpose.
> Fill it in while running the checklist by hand in Chrome, then commit the file.

## How to run this, and what not to run

**This run is read-only.** Only three things are exercised against the tester's own
LinkedIn session: **search**, **profile read**, and **status**. Nothing in this run
sends an invitation, a message, an InMail, a like, a comment or a follow, and nothing
in it unfollows anybody.

Every step marked ✍ is a **write**. A write step must **never** be run against a
primary or professional account. Run the ✍ steps only on a **throwaway LinkedIn
account** created for testing, in a separate Chrome profile, and record which account
was used in the header below. If no throwaway account is available, mark those steps
`SKIPPED — no test account` and say so in the summary; a partial run honestly recorded
is worth more than a complete one that put the tester's account at risk.

The read-only steps are safe on any account, but they still spend real search quota
against LinkedIn's own limits. Keep counts small.

Nothing here uses Playwright, Puppeteer or the Chrome DevTools Protocol. The whole
point of the product is that it is not a browser bot; the smoke test is a human with
a browser, and it stays that way.

---

## Run header

| Field | Value |
| --- | --- |
| Date run | |
| Run by | |
| Chrome version | |
| OS | |
| Extension version (`chrome://extensions`) | expected `2.0.0` |
| Server version (`lit status`) | expected `2.0.0` |
| `linkedin-toolkit-mcp` installed from | `npx` / local `dist/` / npm |
| LinkedIn account used for read-only steps | |
| LinkedIn account used for ✍ write steps | throwaway: |
| Account tier (free / Premium / Sales Navigator / Recruiter) | |
| Sales Navigator seat available? | yes / no |
| Recruiter seat available? | yes / no |
| Result codes | `PASS` · `FAIL` · `PARTIAL` · `SKIPPED` · `N/A` |

---

## Part 1 — the read-only path (run this first, on any account)

The minimum that has to work before anything else is worth checking.

| # | Step | Expected | Result | Notes |
| --- | --- | --- | --- | --- |
| R1 | `chrome://extensions` → Developer mode → **Load unpacked** → pick `extension/` | Loads as "LinkedIn Toolkit" 2.0.0, no errors | | |
| R2 | `npx linkedin-toolkit-mcp` — or `node mcp-server/dist/cli.js serve --http` | Prints the pairing block: bridge port, HTTP port, db path, config path, token, three pairing steps | | |
| R3 | Popup → Settings → Local bridge → paste the token → enable → save | The bridge badge goes from "bridge off" to "connected" within a few seconds | | |
| R4 | `lit status` | `Server: running`, `Extension: connected (v2.0.0)`, `LinkedIn: logged in`, `Mode: Copilot`, four quota rows | | |
| R5 | `lit status --json` | Valid JSON with `connected`, `extensionVersion`, `loggedIn`, `autopilot`, `businessHours`, `quotas.{invite,message,visit,search}`, `queue.pending`, `campaigns.{active,paused}` | | |
| R6 | `lit search "CTO fintech London" --count 10 --json` | `{ profiles: [...], total }`; each profile has `publicId`, `fullName`, `url`, `headline`, `location`, `connectionDegree`, `capturedAt`, `source` | | |
| R7 | Same search again | The Dashboard's **search** quota bar has gone up by the number of **results**, not by one | | |
| R8 | `lit search "CTO fintech London" --count 10 --csv out.csv` | CSV with a header row and one row per profile; opens in a spreadsheet | | |
| R9 | `lit profile <a public profile URL> --json` | One `Profile` object; `publicId` matches the URL | | |
| R10 | `lit profile <same URL> --full --json` | Richer record (experience, summary, photo); the **visit** quota goes up by exactly one | | |
| R11 | `lit profile <same URL> --full --json` again, within the same 24 h | The visit quota does **not** go up a second time (the 24 h metered-read cache) | | |
| R12 | `lit sync --json` then `lit sql "SELECT COUNT(*) FROM profiles" --json` | The count matches what was captured; the mirror survives a server restart | | |
| R13 | Stop the server (Ctrl-C), then run `lit status` | Exactly: `linkedin-toolkit server is not running. Start it with: lit serve --http`, exit code 1 | | |

**Read-only run verdict:** ☐ PASS ☐ FAIL — notes:

---

## Part 2 — the full manual checklist

Reproduced step for step from [`docs/smoke-checklist.md`](smoke-checklist.md).
✍ marks a write; see the warning at the top.

### 0. Load the extension

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| `chrome://extensions` → Developer mode on → **Load unpacked** → pick `extension/` | The extension appears as "LinkedIn Toolkit", version 2.0.0, with no errors under "Errors" | | |
| Click **service worker** to open its console | Console is clean: no red, no "Unchecked runtime.lastError" | | |
| Click the toolbar icon | The popup opens at 380px wide with eight tabs: Dashboard, Extract, Lists, Campaigns, Inbox, Queue, Research, Settings | | |
| Switch the OS/browser theme between light and dark, reopen the popup | Colours follow the theme; text stays readable in both; nothing is left white-on-white | | |

### 1. Dashboard

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| Open the popup **while signed out of LinkedIn** | "LinkedIn signed out" in red, and a line telling you to sign in | | |
| Sign in to linkedin.com in another tab, reopen the popup | "LinkedIn signed in" in green; the header shows "LinkedIn ✓" and "Copilot" | | |
| Read the quota card | Four bars — invite, message, visit, search — each showing `used / cap` and the hourly figure underneath | | |
| Read the bridge badge | "bridge off" until the bridge is enabled in Settings | | |
| Click **Switch to Autopilot** | A confirmation dialog appears first. Nothing changes until you confirm | | |
| Cancel it | Mode stays Copilot | | |
| Confirm it ✍ (changes how later writes behave — switch back straight away) | Mode becomes Autopilot; the header badge turns to "Autopilot" | | |
| Switch back to Copilot | No confirmation is asked; mode returns to Copilot | | |
| Close and reopen the popup | It opens on the tab you were last on | | |

### 2. Extract — one search

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| Extract → **People search** → keywords "head of talent", per page 10, pages 1 → **Run** | Spinner on the button; a progress bar; then "10 results" (or fewer) | | |
| Read the search quota bar on the Dashboard | The search bucket has gone up | | |
| Click **Download CSV** | Chrome's save dialog opens with `search-YYYY-MM-DD.csv`. The file opens in a spreadsheet with a header row and one row per person | | |
| Click **Download JSON** | Same, `.json`, and the file parses | | |
| Choose **+ New list…**, type a name, **Save to list** | "Saved N (0 duplicates)." | | |
| Run the same search again and save to the same list | Duplicates are reported, not re-added | | |
| Extract → **Profile export** → paste 12 profile URLs → **Export profiles** | Progress moves in two batches of 10 and 2; the result count matches | | |
| Run any extraction **while signed out** | A single red line naming the error code (`NOT_LOGGED_IN`), not a blank card, and no console exception | | |

### 3. Lists

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| Lists tab | The list you just saved appears with its member count | | |
| Click it | Members table with names, roles, "added" dates and any signal badges | | |
| Tick two members → choose a campaign → **Enrol** ✍ | "Enrolled 2 (0 skipped)." | | |
| **Import** a small CSV (`name,linkedin_url`) | Reports added / duplicates / invalid; the member count goes up | | |
| **Export CSV** | Save dialog with the engine's filename; the file matches the members | | |
| **Delete list** | Confirmation dialog first; after confirming the list is gone from the list of lists | | |

### 4. Campaigns

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| Campaigns → **Load template** → "Warm connect" → Load | Five steps appear: view, wait, follow, wait, invite. The invite carries a note and two alternatives | | |
| Click a variable button in the note (the firstName one) | The token is inserted at the caret, not appended at the end | | |
| Add a **Branch** step | "When" select plus Then and Otherwise sub-editors, each with their own "Add step" | | |
| Add a **message** step inside **Then** | It nests visually, indented under Then | | |
| Reorder with ↑ / ↓ and delete one step with × | The list reorders and shrinks as expected | | |
| Name it, pick a list, tick "Stop when they reply", **Create campaign** ✍ | It appears in the campaign list as `active` | | |
| **Pause**, then **Resume** | The status pill follows | | |
| **Stats** | A per-step table appears with sent / accepted / replied columns | | |
| **Delete** | Confirmation dialog first | | |

### 5. One dry-run invite, then one queued invite ✍ (throwaway account only)

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| Ensure the mode is **Copilot** (Dashboard) | Header reads "Copilot" | | |
| Have an agent (or the MCP `lit` CLI) send an invite with `dry_run: true` | The response says `dryRun` and nothing is queued; the person receives nothing | | |
| Have it send the same invite for real ✍ | Response says `queued`; the Dashboard's "Queued" count goes up by one; a "N queued" badge appears in the header | | |
| Queue tab | The item shows the person's name, "Invite", origin, and the note in an editable box | | |
| Edit the note, click **Approve** ✍ | "Approved 1." The item leaves the pending filter | | |
| Switch the filter to **Sent** | The item is there, its text is the **edited** text, and the textarea is read-only | | |
| Check LinkedIn's own "Sent invitations" page | One invitation, carrying the edited note | | |
| Queue a second item and click **Reject** | It moves to the Rejected filter and nothing is sent | | |
| Queue two items and click **Approve all (2)** ✍ | Both are approved in one go | | |

### 6. Inbox

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| Inbox tab | Conversations with unread dots and, where the engine has scored them, sentiment badges | | |
| Tick **Unread only** | The list reloads and shows only unread threads | | |
| Open a thread | Messages appear oldest-first; your own messages are tinted differently | | |
| Type a reply and click **Send reply** in Copilot mode | "Queued for your approval" — and the item is in the Queue tab | | |
| Approve it from the Queue ✍ | The message arrives in LinkedIn's own inbox | | |
| Click **Save as reply**, then reopen the thread | The text is in the "Saved replies…" dropdown and in the Saved replies card | | |
| **Snooze 3d** a thread | It disappears from the list; ticking "Show snoozed" brings it back with an **Unsnooze** button | | |

### 7. Research Pack

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| Research tab → drag a CSV onto the drop zone | The zone highlights while dragging; on drop, "N rows read" | | |
| Read the Columns card | name / LinkedIn URL / email / domain / company are mapped automatically; any extra columns appear as extra preview columns | | |
| Change one mapping by hand | The preview table updates immediately | | |
| Tick enrichment, name a list, **Build research packs** | A progress bar with "done of total", the job status, and an ETA | | |
| Leave the popup open for a minute | Progress advances roughly every five seconds | | |
| Find an unresolved row | It shows a red "unresolved" badge and a dropdown of candidates | | |
| Pick a candidate and click **Use this** | That single row is re-run and resolves | | |
| **Download output.csv** and **Download packs.md** | Both save; the CSV has one row per pack, the Markdown has one section per pack separated by `---` | | |
| Close the popup mid-job, reopen the Research tab | No console errors; the tab starts clean (jobs continue in the engine and can be re-polled by an agent) | | |

### 8. Settings and options

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| Settings tab → change the account type to "Sales Navigator" | The pacing and cap fields fill in with that preset's values | | |
| Type `99999` into "Invites / day" | The field clamps itself to 100 as you type | | |
| **Save settings**, reopen the popup | The saved values are still there | | |
| Pick an AI provider (e.g. Ollama with a local model) | Only the fields that provider uses are shown — no API key box for Ollama | | |
| Click **Test** | The settings save first, then a one-line result appears naming the provider and model. With no provider set, the error line says `AI_NOT_CONFIGURED` | | |
| Enable the bridge, set the port to 47829, paste the token, save | The badge says "not connected" until the MCP server is running, then "connected" after it pairs | | |
| Open the options page (footer link, or right-click the icon → Options) | The same form, full width, plus "Settings file" and "Danger zone" | | |
| **Export settings** | A JSON file with the whole Config | | |
| Change a value, then **Import settings** with that file | The old value comes back | | |
| **Clear all data** (do this last — it erases lists, campaigns and settings) | The confirm button is disabled until you type `ERASE`; after confirming, lists, campaigns and settings are gone and the form redraws with defaults | | |

### 9. Challenge banner

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| Simulate a challenge: in the service worker console, run `chrome.storage.local.get('status')` first to see the shape, then set the engine's challenge flag (`quota.js` records `challenge: { detectedAt }`) | — | | |
| Reopen the popup | A red banner at the top of the Dashboard: "LinkedIn asked for a security check", with the time it was detected | | |
| Confirm that outreach is refused while it is set | Any write returns `CHALLENGE_DETECTED` on its error line | | |
| Clear the challenge in a LinkedIn tab, then click **I've cleared it** | The banner disappears and writes work again | | |

### 10. Resilience

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| With the popup open, reload the extension from `chrome://extensions` | The popup's next action shows `EXTENSION_OFFLINE` with "Reload the extension…", not a silent hang | | |
| Open the popup with LinkedIn rate-limiting you (or force `backoffUntil` in storage) | An amber banner says how long the toolkit is backing off for | | |
| Watch the service worker console through the whole run | No uncaught exceptions, and no `innerHTML`-related CSP warnings | | |

---

## Part 3 — endpoints to verify

Every LinkedIn path the engine uses lives in `ENDPOINTS` in
`extension/src/background/voyager.js`. These are the ones WS-B declared **unverified
against a live session** — they are guesses, migrations, or surfaces LinkedIn has moved
before. Everything not listed here (`profileView`, `searchClusters`, `companies`,
`conversations`, `conversationEvents`, `normInvitations` for received invitations,
`reactions`, `comments`) is unchanged from v1 or long-stable and is covered by Part 1
and Part 2 above.

An endpoint that has moved does not usually error — it returns a differently shaped
body, and the normaliser quietly produces an empty collection. So the check is not
"did it 200", it is **"did the shape below actually come back, with real people in
it"**. Record the raw HTTP status and the number of records in Notes.

| # | Endpoint key | Path and query | Action that exercises it | How to run it | Expected shape | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | `salesNavSearch` | `https://www.linkedin.com/sales-api/salesApiPeopleSearch?q=peopleSearchQuery&…` | `search.people { source: 'salesnav' }` | `lit search "head of platform" --source salesnav --count 10 --json` | `{ profiles: Profile[], total: number }`, ≥1 profile with a real `publicId` and `fullName` | | |
| E2 | `recruiterSearch` | `https://www.linkedin.com/talent/api/talentRecruiterSearch?q=recruiterSearch&…` | `search.people { source: 'recruiter' }` | `lit search "head of platform" --source recruiter --count 10 --json` | Same `{ profiles, total }` page | | |
| E3 | `eventAttendees` | `/events/dash/professionalEventAttendees?q=eventAttendees&eventUrn=…` | `event.attendees` | `POST /actions/event.attendees {"eventUrl": "<a LinkedIn event you can see>"}` | `{ profiles: Profile[], total?, nextStart? }` | | |
| E4 | `followers` | `/identity/dash/profileFollowers?q=followersOfViewer&start&count` | `network.followers` | `POST /actions/network.followers {"count": 25}` | `{ profiles: Profile[], total? }` — your own followers | | |
| E5 | `groupMemberships` | `/groups/groupMemberships?q=group&groupUrn=…` | `group.members` | `POST /actions/group.members {"groupUrl": "<a group you belong to>"}` | `{ profiles: Profile[], total?, nextStart? }` | | |
| E6 | `memberPosts` | `/identity/profileUpdatesV2?q=memberShareFeed&…` | `research.pack` (fills `recentPosts`) | Research a single row for someone who posts often | `recentPosts: [{ url, text, likes?, comments?, postedAt? }]`, non-empty for an active poster | | |
| E7 | company employees | `search/dash/clusters` with `currentCompany:List(<universalName>)` | `company.employees` | `lit company <a company URL> --employees --json` | `{ profiles: Profile[], total, nextStart? }`. **Suspected wrong:** LinkedIn normally wants the numeric company id here, not a universalName. If this returns zero, the fix is to take the id from `company.get` first | | |
| E8 | mutual connections | `search/dash/clusters` with `connectionOf:List(<urnId>), network:List(F), count=0` | `research.pack` (fills `mutualConnections`) | Research one row for someone you share connections with | `mutualConnections: <number>` matching what the profile page shows. **Suspected wrong:** the `total` may not be returned at `count=0` | | |
| E9 | `normInvitations` (sent) | `growth/normInvitations?q=sentInvitationsV2&start&count` | `network.status`, the campaign `accepted` branch, the already-connected pre-check | ✍ throwaway account: send one invite, then `POST /actions/network.status {"publicIds":["<that person>"]}` | `{ statuses: { "<publicId>": "pending" } }` — **`pending`, never `connected`**, while the invitation is outstanding. This is the one new path in v2 and three features depend on it | | |
| E10 | `followingStates` | `/feed/dash/followingStates/{urn}?action=toggleFollow`, body `{patch:{$set:{following:true}}}` | `outreach.follow` | ✍ throwaway account: `POST /actions/outreach.follow {"publicId":"…"}` | `{ status: 'sent', sentAt }` **and** the person's page actually shows "Following". Body shape is the uncertain part | | |
| E11 | ~~`profileViewBeacon`~~ | ~~`/identity/dash/profileViews`~~ | — | **Removed.** Nothing to smoke-test | The beacon was unreachable from any action: `viewProfile`'s `beacon` option had exactly one caller, which never passed it, and `beacon` was not a param on `outreach.view`. A plain visit relies on the `profileView` GET, which is what LinkedIn actually records, so nothing was lost. The endpoint, the option and the dead `dashProfiles` / `getConnectionStatus` / legacy `searchPeople` alongside it were deleted rather than left as untested code claiming to work | n/a | n/a |
| E12 | `reactions` / `comments` urn rewrite | `urn:li:ugcPost:<id>` rewritten to `urn:li:activity:<id>` | `post.engagers`, `outreach.like`, `outreach.comment` | `lit engagers "<a document or article share permalink>" --kind both --json`, then ✍ throwaway account: `POST /actions/outreach.like {"postUrl":"<that same permalink>"}` and `POST /actions/outreach.comment {"postUrl":"…","body":"…"}` | `{ engagers: [...] }` non-empty, and the like/comment land on the post itself rather than failing on the urn. Right for most posts; document and article shares are the case worth checking, and the two write paths rewrite the same urn, so they exercise it from the other side | | |

### If an endpoint comes back empty

1. Open the service worker console and re-run the action; the raw response is logged there.
2. Record the **HTTP status**, the **top-level keys** of the body, and where the people
   actually are in it (`elements`, `data.elements`, `included`, …) in the Notes column.
3. That is enough to fix the normaliser — do not guess at a new path in the smoke run.
4. File it as an issue with the recorded shape. `docs/build-an-extractor.md` is the
   reference for how a normaliser is written.

---

## Summary

| | |
| --- | --- |
| Read-only run (Part 1) | ☐ PASS ☐ FAIL ☐ PARTIAL |
| Full checklist (Part 2) | ☐ PASS ☐ FAIL ☐ PARTIAL ☐ SKIPPED — no test account |
| Endpoints verified (Part 3) | ___ of 12 |
| Blocking issues found | |
| Non-blocking issues found | |
| Issues filed | |
| Cleared for release? | ☐ yes ☐ no |
| Signed off by | |
