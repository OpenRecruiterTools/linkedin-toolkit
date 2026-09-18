# Installing LinkedIn Toolkit

Two ways in. The first is one command and takes about a minute; the second needs no
terminal at all and takes about five. Both end in the same place, and both leave the
extension loaded from a folder on your own machine.

(If you want to connect an AI agent as well, the one command below does that too —
see [docs/clients.md](clients.md) for every client's config.)

**Before you start, read this once.** LinkedIn's User Agreement does not allow you
to automate your account, and LinkedIn restricts and permanently bans accounts for
it. Mass unfollow makes the same requests your own browser makes when you press
Unfollow, and LinkedIn cannot tell that apart from you doing it fast. That risk is
yours. Do not use this on an account you cannot afford to lose. The longer version is in
[docs/safety.md](safety.md).

---

## The quick way: one command, then three clicks

You need [Node.js 20 or newer](https://nodejs.org). In a terminal:

```bash
npx linkedin-toolkit-mcp setup
```

It downloads the extension, checks it really is one, unpacks it to a folder it will
keep (`~/.linkedin-toolkit/extension`), prints that folder's exact path, prints your
pairing token, and waits for the extension to connect. Add `--client claude-code`
(or `claude-desktop`, `cursor`, `windsurf`, `vscode`, `n8n`, `print`) and it writes
your agent's MCP config too, keeping any other servers already in that file and
backing it up first. `--dry-run` shows you everything it would do and writes nothing.

Then do the three steps in the next section. Chrome does not allow any installer,
script or extension to load an unpacked extension for you — that is the point of the
switch — so those three are yours.

> `lit setup` is the same command once the package is installed. `lit setup --dir
> ~/Documents/linkedin-toolkit` unpacks somewhere else; run it again any time to
> update, and it swaps the new copy in only once it has unpacked cleanly.

## The three clicks

### 1. Open Chrome's extensions page

Type `chrome://extensions` into the address bar and press Enter. (It will not
appear in search results — it has to be typed into the address bar.)

Turn on **Developer mode** with the switch in the top-right corner. Three new
buttons appear along the top.

![step](assets/install-2-extensions.png)

### 2. Click "Load unpacked" and choose the folder

Click **Load unpacked**. Your computer's normal folder-picker window opens — the
same one you would get opening any file.

Choose the folder *itself* — the one `setup` printed, or the one you unzipped — and
not a file inside it (if you can see a file called `manifest.json` listed, you are in
the right folder: click *Select Folder* / *Open* while it is highlighted).

### 3. Check it loaded

"LinkedIn Toolkit" now appears as a card on the extensions page.

![step](assets/install-3-loaded.png)

If instead you get a red error, the most common cause is picking the wrong folder —
one level too high or too low. Delete the card and try again.

<details>
<summary><b>No terminal: installing the extension by hand</b></summary>

### 1. Download the file

Go to the [Releases page](https://github.com/OpenRecruiterTools/linkedin-toolkit/releases)
and, under the newest release, click the file whose name ends in `.zip` — it is
called something like `linkedin-toolkit-extension-v2.0.4.zip`.

![step](assets/install-1-release.png)

### 2. Unzip it, and put the folder somewhere you will keep it

Double-click the downloaded file (Windows: right-click → *Extract All*). You get a
folder with the same name.

**Move that folder somewhere permanent** — Documents is fine. Chrome loads the
extension from this folder every single time it starts, so if you leave it in
Downloads and later clear out Downloads, the extension disappears.

### 3. Then do the three clicks above

Point **Load unpacked** at that folder. Everything else on this page is the same.

</details>

### Pin the icon so you can find it

Click the jigsaw-piece icon at the top-right of Chrome, find "LinkedIn Toolkit" in
the list, and click the pin next to it. Its icon now sits next to the address bar,
where you can reach it in one click.

### Open LinkedIn, then open the popup

Go to [linkedin.com](https://www.linkedin.com/) and sign in as normal. Then click
the LinkedIn Toolkit icon.

![step](assets/install-5-popup.png)

The popup only works on a tab where you are signed in to LinkedIn — that is where
it gets its access from. There is no account to create and no password to give it.

### If you are connecting an agent: pair the bridge

Settings → **Local bridge** → paste the pairing token `setup` printed (or run
`lit config get token --reveal` to see it again) → enable. `lit status` then says
"Extension: connected". Nothing here leaves your machine: the token is a local
secret shared between the extension and the server on the same computer.

Config for Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, n8n and the rest:
[docs/clients.md](clients.md).

---

## Clean your feed

The "Mass unfollow" panel, at the bottom of the **Extract** tab, unfollows people
and pages so your feed calms down. It does **not** remove anyone from your
connections — they stay connected to you, you just stop seeing their posts.

![step](assets/install-6-unfollow.png)

Open LinkedIn in the tab you are going to use, click the toolkit icon, and go to
the Extract tab. Then work through these three steps in order. Do not skip to the
third one.

### Step 1 — Preview

Leave "Unfollow up to" at 25 and click **Preview**.

Nothing is unfollowed. The toolkit walks your Following list exactly as it would
for real, and shows you the list of names it *would* unfollow. Read it. If those
are not the people you expected, stop here — nothing has happened.

### Step 2 — Unfollow a small number first

Change "Unfollow up to" to **1**, then click **Unfollow all** and confirm.

The progress line counts up as it goes, and **Stop** ends the run after the person
in flight — what is already unfollowed stays unfollowed. When it finishes, it tells
you who it unfollowed. Check that person really is unfollowed on LinkedIn.

That is the whole point of the number box. Try it on one person, then on five,
before you trust it with eight hundred.

### Step 3 — Then the rest

Once you have seen it work, set the number to whatever you want — or clear the box
entirely to work through everyone — and run it. It goes at about one person a
second, so eight hundred is a bit under a quarter of an hour; leave the popup open
if you want to watch it, and press **Stop** whenever you have had enough.

### Connections are followed too

Empty the Following list to zero and your feed will still be full of posts. That is
not a bug in the toolkit: **LinkedIn does not put your connections on your Following
list at all.** You are made to follow everybody you connect with, automatically, at
the moment you connect, and nothing on that page ever mentions it. Tick **"Also
unfollow my connections"** and the run adds a second pass — a page-by-page read of
your *followers*, which is the only place LinkedIn says whether you are still
following somebody — and unfollows the ones you are. Unfollowing a connection does
not disconnect you: you stay connected, they stay in your network, you simply stop
seeing their posts until you follow them again by hand.

It is slower, and it is slower because it is reading rather than writing: a page of
fifty followers every half second or so, which is a couple of minutes for ten
thousand followers before the first of them is unfollowed. "Check count" with the
box ticked does the same read and tells you the number without changing anything —
that is the honest way to find out how big the job is. The limit, the Stop button
and the preview all work across both lists exactly as they do across one.

### Fast, and why it is not the default

**"Fast (3 at a time)"** runs three unfollows at once instead of one, about four a
second rather than one. It is genuinely quicker — a nine-hundred-person list in
four minutes instead of twenty — and it is genuinely more likely to be the thing
LinkedIn rate-limits, because four requests a second is not a shape a person makes.
If it trips one, the run stops on the spot and keeps what it did, and you should
leave it for the day. Careful, one at a time, is the default and the one to use;
tick Fast when you have already watched a careful run work and you are impatient,
not the first time.

Under **Advanced** there is a second way to do it, "Browser tab", which drives your
own Following page and clicks the buttons on it. It is three times slower and it is
there for one reason: if LinkedIn changes the API the fast mode uses, the page a
human can click still works. Leave it alone unless the fast mode has stopped
working. It is the Following list only: there is no followers page with an Unfollow
button on it to click, so "Also unfollow my connections" needs the fast mode.

While it runs:

- **It is slower than it could be, on purpose.** One person every 0.8–1.6
  seconds, at a randomised interval. A burst is exactly the shape that gets
  accounts restricted, so it does not make one. ("Browser tab" mode is slower
  still, at 2–5 seconds, because clicking a page costs more than a request.)
- **You can leave.** The fast mode needs no tab, so carry on working; closing the
  popup does not stop the run, and reopening it picks the count back up.
- **If LinkedIn interrupts** — a rate limit, a security check, a "we noticed
  unusual activity" page — the run stops on the spot and reports how far it got.
  Do not restart it that day. In "Browser tab" mode, navigating that tab
  somewhere else stops it too; it will never follow you to another tab.
- **There is no undo.** Unfollowing 800 people cannot be reversed in bulk; you
  would have to re-follow each of them by hand.

"Check count" tells you how many accounts you currently follow, plus the first few
names, without changing anything. With "Also unfollow my connections" ticked it also
reads your followers list and tells you how many of *those* you are still following
— the number the Following list does not show you.

---

## If something goes wrong

**The icon is greyed out or the popup is empty.** You are not on a LinkedIn tab,
or you are not signed in. Open linkedin.com, sign in, then click the icon again.

**"Mass unfollow cannot be undone…"** You reached the action from somewhere other
than the popup. That is deliberate — this one action can only be started by a
person, never by an agent.

**Nothing happens when you press Unfollow.** The fast (default) mode talks to
LinkedIn directly and needs no tab; watch the progress line, which updates as it
goes, and press Stop if you want it to end early. In the slower **Browser tab**
mode, under "Advanced", check the LinkedIn tab is actually on your Following
list — the toolkit will navigate there itself, so give it a few seconds on a slow
connection.

**Chrome says the extension is corrupted, or it vanishes after a restart.** The
folder moved or was deleted. Re-download, unzip somewhere permanent, and load it
again.

**Updating to a new version.** Run `npx linkedin-toolkit-mcp setup` again — it
unpacks the new copy beside the old one and swaps it in, so the folder Chrome
points at never changes. Then click the refresh arrow on the extension's card at
`chrome://extensions`. By hand: download the new zip and unzip it over the old
folder, then refresh the same way.

**`setup` said the download is not a zip.** GitHub served something else — an error
page, or a proxy's login page. Check the
[Releases page](https://github.com/OpenRecruiterTools/linkedin-toolkit/releases) in a
browser; nothing was unpacked, and your previous copy is untouched.

---

## Why it is not in the Chrome Web Store

Store policy forbids extensions that facilitate breaking another site's terms of
service, and an honest reading of LinkedIn's terms puts automating your own
account in that territory. Loading it unpacked keeps the decision — and the code
you are running, which you can read — with you.
