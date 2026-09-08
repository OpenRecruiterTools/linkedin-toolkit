# Manual smoke checklist

Run this by hand in Chrome before every release, and after any change to the
popup, the options page or the engine's action router. It takes about twenty
minutes.

**Use a throwaway LinkedIn account.** Every step below performs real actions in
a real session. Nothing here should ever be run against an account you care
about, and nothing here should be run against a second account belonging to
someone else.

Automated tests cover the UI against a stubbed engine (`npm test`). This
checklist covers what only a browser can: the real service worker, real
`chrome.*` APIs, and real LinkedIn responses.

---

## 0. Load the extension

| Step                                                                              | Expected                                                                                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `chrome://extensions` → Developer mode on → **Load unpacked** → pick `extension/` | The extension appears as "LinkedIn Toolkit", version 2.0.0, with no errors under "Errors"                             |
| Click **service worker** to open its console                                      | Console is clean: no red, no "Unchecked runtime.lastError"                                                            |
| Click the toolbar icon                                                            | The popup opens at 380px wide with eight tabs: Dashboard, Extract, Lists, Campaigns, Inbox, Queue, Research, Settings |
| Switch the OS/browser theme between light and dark, reopen the popup              | Colours follow the theme; text stays readable in both; nothing is left white-on-white                                 |

## 1. Dashboard

| Step                                                     | Expected                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Open the popup **while signed out of LinkedIn**          | "LinkedIn signed out" in red, and a line telling you to sign in                                         |
| Sign in to linkedin.com in another tab, reopen the popup | "LinkedIn signed in" in green; the header shows "LinkedIn ✓" and "Copilot"                              |
| Read the quota card                                      | Four bars — invite, message, visit, search — each showing `used / cap` and the hourly figure underneath |
| Read the bridge badge                                    | "bridge off" until the bridge is enabled in Settings                                                    |
| Click **Switch to Autopilot**                            | A confirmation dialog appears first. Nothing changes until you confirm                                  |
| Cancel it                                                | Mode stays Copilot                                                                                      |
| Confirm it                                               | Mode becomes Autopilot; the header badge turns to "Autopilot"                                           |
| Switch back to Copilot                                   | No confirmation is asked; mode returns to Copilot                                                       |
| Close and reopen the popup                               | It opens on the tab you were last on                                                                    |

## 2. Extract — one search

| Step                                                                                    | Expected                                                                                                                          |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Extract → **People search** → keywords "head of talent", per page 10, pages 1 → **Run** | Spinner on the button; a progress bar; then "10 results" (or fewer)                                                               |
| Read the search quota bar on the Dashboard                                              | The search bucket has gone up                                                                                                     |
| Click **Download CSV**                                                                  | Chrome's save dialog opens with `search-YYYY-MM-DD.csv`. The file opens in a spreadsheet with a header row and one row per person |
| Click **Download JSON**                                                                 | Same, `.json`, and the file parses                                                                                                |
| Choose **+ New list…**, type a name, **Save to list**                                   | "Saved N (0 duplicates)."                                                                                                         |
| Run the same search again and save to the same list                                     | Duplicates are reported, not re-added                                                                                             |
| Extract → **Profile export** → paste 12 profile URLs → **Export profiles**              | Progress moves in two batches of 10 and 2; the result count matches                                                               |
| Run any extraction **while signed out**                                                 | A single red line naming the error code (`NOT_LOGGED_IN`), not a blank card, and no console exception                             |

## 3. Lists

| Step                                             | Expected                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Lists tab                                        | The list you just saved appears with its member count                               |
| Click it                                         | Members table with names, roles, "added" dates and any signal badges                |
| Tick two members → choose a campaign → **Enrol** | "Enrolled 2 (0 skipped)."                                                           |
| **Import** a small CSV (`name,linkedin_url`)     | Reports added / duplicates / invalid; the member count goes up                      |
| **Export CSV**                                   | Save dialog with the engine's filename; the file matches the members                |
| **Delete list**                                  | Confirmation dialog first; after confirming the list is gone from the list of lists |

## 4. Campaigns

| Step                                                                   | Expected                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Campaigns → **Load template** → "Warm connect" → Load                  | Five steps appear: view, wait, follow, wait, invite. The invite carries a note and two alternatives |
| Click a variable button in the note (the firstName one)                | The token is inserted at the caret, not appended at the end                                         |
| Add a **Branch** step                                                  | "When" select plus Then and Otherwise sub-editors, each with their own "Add step"                   |
| Add a **message** step inside **Then**                                 | It nests visually, indented under Then                                                              |
| Reorder with ↑ / ↓ and delete one step with ×                          | The list reorders and shrinks as expected                                                           |
| Name it, pick a list, tick "Stop when they reply", **Create campaign** | It appears in the campaign list as `active`                                                         |
| **Pause**, then **Resume**                                             | The status pill follows                                                                             |
| **Stats**                                                              | A per-step table appears with sent / accepted / replied columns                                     |
| **Delete**                                                             | Confirmation dialog first                                                                           |

## 5. One dry-run invite, then one queued invite

| Step                                                                     | Expected                                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Ensure the mode is **Copilot** (Dashboard)                               | Header reads "Copilot"                                                                                          |
| Have an agent (or the MCP `lit` CLI) send an invite with `dry_run: true` | The response says `dryRun` and nothing is queued; the person receives nothing                                   |
| Have it send the same invite for real                                    | Response says `queued`; the Dashboard's "Queued" count goes up by one; a "N queued" badge appears in the header |
| Queue tab                                                                | The item shows the person's name, "Invite", origin, and the note in an editable box                             |
| Edit the note, click **Approve**                                         | "Approved 1." The item leaves the pending filter                                                                |
| Switch the filter to **Sent**                                            | The item is there, its text is the **edited** text, and the textarea is read-only                               |
| Check LinkedIn's own "Sent invitations" page                             | One invitation, carrying the edited note                                                                        |
| Queue a second item and click **Reject**                                 | It moves to the Rejected filter and nothing is sent                                                             |
| Queue two items and click **Approve all (2)**                            | Both are approved in one go                                                                                     |

## 6. Inbox

| Step                                                  | Expected                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Inbox tab                                             | Conversations with unread dots and, where the engine has scored them, sentiment badges         |
| Tick **Unread only**                                  | The list reloads and shows only unread threads                                                 |
| Open a thread                                         | Messages appear oldest-first; your own messages are tinted differently                         |
| Type a reply and click **Send reply** in Copilot mode | "Queued for your approval" — and the item is in the Queue tab                                  |
| Approve it from the Queue                             | The message arrives in LinkedIn's own inbox                                                    |
| Click **Save as reply**, then reopen the thread       | The text is in the "Saved replies…" dropdown and in the Saved replies card                     |
| **Snooze 3d** a thread                                | It disappears from the list; ticking "Show snoozed" brings it back with an **Unsnooze** button |

## 7. Research Pack

| Step                                                   | Expected                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Research tab → drag a CSV onto the drop zone           | The zone highlights while dragging; on drop, "N rows read"                                                                 |
| Read the Columns card                                  | name / LinkedIn URL / email / domain / company are mapped automatically; any extra columns appear as extra preview columns |
| Change one mapping by hand                             | The preview table updates immediately                                                                                      |
| Tick enrichment, name a list, **Build research packs** | A progress bar with "done of total", the job status, and an ETA                                                            |
| Leave the popup open for a minute                      | Progress advances roughly every five seconds                                                                               |
| Find an unresolved row                                 | It shows a red "unresolved" badge and a dropdown of candidates                                                             |
| Pick a candidate and click **Use this**                | That single row is re-run and resolves                                                                                     |
| **Download output.csv** and **Download packs.md**      | Both save; the CSV has one row per pack, the Markdown has one section per pack separated by `---`                          |
| Close the popup mid-job, reopen the Research tab       | No console errors; the tab starts clean (jobs continue in the engine and can be re-polled by an agent)                     |

## 8. Settings and options

| Step                                                                   | Expected                                                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings tab → change the account type to "Sales Navigator"            | The pacing and cap fields fill in with that preset's values                                                                                          |
| Type `99999` into "Invites / day"                                      | The field clamps itself to 100 as you type                                                                                                           |
| **Save settings**, reopen the popup                                    | The saved values are still there                                                                                                                     |
| Pick an AI provider (e.g. Ollama with a local model)                   | Only the fields that provider uses are shown — no API key box for Ollama                                                                             |
| Click **Test**                                                         | The settings save first, then a one-line result appears naming the provider and model. With no provider set, the error line says `AI_NOT_CONFIGURED` |
| Enable the bridge, set the port to 47829, paste the token, save        | The badge says "not connected" until the MCP server is running, then "connected" after it pairs                                                      |
| Open the options page (footer link, or right-click the icon → Options) | The same form, full width, plus "Settings file" and "Danger zone"                                                                                    |
| **Export settings**                                                    | A JSON file with the whole Config                                                                                                                    |
| Change a value, then **Import settings** with that file                | The old value comes back                                                                                                                             |
| **Clear all data**                                                     | The confirm button is disabled until you type `ERASE`; after confirming, lists, campaigns and settings are gone and the form redraws with defaults   |

## 9. Challenge banner

| Step                                                                                                                                                                                                               | Expected                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Simulate a challenge: in the service worker console, run `chrome.storage.local.get('status')` first to see the shape, then set the engine's challenge flag (WS-B's `quota.js` records `challenge: { detectedAt }`) | —                                                                                                              |
| Reopen the popup                                                                                                                                                                                                   | A red banner at the top of the Dashboard: "LinkedIn asked for a security check", with the time it was detected |
| Confirm that outreach is refused while it is set                                                                                                                                                                   | Any write returns `CHALLENGE_DETECTED` on its error line                                                       |
| Clear the challenge in a LinkedIn tab, then click **I've cleared it**                                                                                                                                              | The banner disappears and writes work again                                                                    |

## 10. Resilience

| Step                                                                                | Expected                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| With the popup open, reload the extension from `chrome://extensions`                | The popup's next action shows `EXTENSION_OFFLINE` with "Reload the extension…", not a silent hang |
| Open the popup with LinkedIn rate-limiting you (or force `backoffUntil` in storage) | An amber banner says how long the toolkit is backing off for                                      |
| Watch the service worker console through the whole run                              | No uncaught exceptions, and no `innerHTML`-related CSP warnings                                   |
