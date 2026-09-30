# CAPTCHAs and security checks

LinkedIn sometimes stops what you are doing and asks you to prove you are you: a CAPTCHA puzzle, a
"Let's do a quick security check" page, a code sent to your email or phone, or a request to sign
in again. This page says what brings that on, what the toolkit does when it happens, what you
should do, and what we will not build.

**The short version.** The toolkit notices the check, stops everything, and tells you. You
complete the check yourself, in your own browser. You leave automation alone for a while. Then you
press a button to say you are done. The toolkit never tries to solve a check or get round one.

## What triggers a check

LinkedIn does not publish its rules, so nobody outside LinkedIn can give you a complete list. These
are the things most often reported to bring a check on, and every one of them is something
LinkedIn can plainly see:

- **A new device, browser or IP address.** Signing in from somewhere LinkedIn has not seen you
  before — a new laptop, a fresh browser profile, a different network, a hotel or a café.
- **Speed.** Actions closer together than a person would manage: several a second, or a steady
  rhythm with no pauses in it.
- **Volume.** A lot of one thing in one day — invitations, messages, searches — especially on an
  account that does not usually do much.
- **Many profile views.** Opening profile after profile is the classic scraping pattern, and
  LinkedIn meters it separately from everything else.
- **A fresh or restricted account.** A new account, one that has been dormant, or one that has
  been warned or restricted before gets much less room than an established one.
- **VPNs and proxies.** An IP address shared with thousands of strangers, or one that puts you in
  a different country from yesterday, looks wrong whatever you are doing on it.
- **Two tools at once.** Two automation tools on one account cannot see each other's pacing.
  LinkedIn sees the sum.

A check is not a ban. It is LinkedIn asking a question. What you do next decides how it goes.

## What the toolkit does when one appears

### It notices

Every response from LinkedIn is classified before anything reads it
([`extension/src/lib/classify-response.js`](../extension/src/lib/classify-response.js)). A check
shows up in one of these ways:

| What comes back | What it means | What the engine does |
|---|---|---|
| The request is **redirected** to `/checkpoint/…` or a path containing `/challenge` | Security check | Stops everything |
| A `200` that is an **HTML page** mentioning a CAPTCHA, a security check, a security verification, "verify you're human", unusual activity or a checkpoint | Security check | Stops everything |
| A JSON body carrying a top-level `challengeUrl`, or a `403` whose body names a challenge | Security check | Stops everything |
| **451** | Security check | Stops everything |
| The request is **redirected** to `/login`, `/uas/login`, `/m/login` or `/authwall`, or a `200` that is the sign-in page, or **401** | You are signed out | Stops that action; sign in again |
| **429** or **999** | Rate limited | Backs off (15 minutes, or an hour) |

The redirect row is the one that matters most. LinkedIn's usual way of interrupting an API call is
not an error code: it sends the request to a web page, the browser follows it, and what arrives
looks like a success — status 200, a page of HTML. Before version 2.1.1 of the extension the
toolkit read that as "LinkedIn returned a non-JSON response" and did not pause. It now recognises
it as the check it is.

Only the path of the final address is matched, never the query string, so an ordinary search for
"coding challenge" does not set anything off.

### It stops

A check sets the **challenge latch**. While it is set:

- Every request to LinkedIn is refused *before it leaves your browser*. Not slowed down — refused.
- Campaigns, the approval queue, research packs, exports and mass unfollow all stop where they are.
- Whatever was in flight when the check arrived is **not counted as done**. A redirected write is
  never treated as a success, even if a 200 came back.
- Every tool call returns `CHALLENGE_DETECTED`. `status.get` reports `challenge: { detectedAt }`.

Time passing does not clear the latch. Restarting Chrome does not clear it. An agent cannot clear
it: `config.set { clearChallenge: true }` is honoured from the popup and silently dropped from
everywhere else.

### It tells you

- A desktop notification, and a `challenge_detected` event to your webhook if you have one.
- A banner at the top of the popup's Dashboard, titled **LinkedIn is asking you to confirm it's
  you**, with the time it was detected and three numbered steps.
- The error itself says what happened in plain words — that LinkedIn sent the request to a
  security check page — rather than quoting a status code.

### It waits for you

The banner has an **Open LinkedIn** button, which opens linkedin.com in a new tab and does nothing
else, and an **I've done it — resume** button. The second one is the only thing in the whole
toolkit that lifts the pause, and only a person can press it.

If you were signed out rather than challenged, there is no latch. Sign in again and carry on.

## What you should do

1. **Complete the check by hand.** Open LinkedIn in the same browser and do whatever it asks: the
   puzzle, the code, the sign-in. If LinkedIn shows you nothing unusual straight away, open your
   feed, a profile and My Network, and see whether it asks then.
2. **Wait.** Leave automation alone for at least 24 hours. The banner shows when that is. Using
   LinkedIn by hand in the meantime is fine.
3. **Lower your caps** before you resume. If you were at 25 invitations a day, try 10. If you were
   near the ceiling on profile visits, halve it.
4. **Keep warm-up on.** It ramps your caps over 14 days instead of starting at the full number.
   After a check, turn it back on even on an established account.
5. **Do not run two automation tools at once.** Not two extensions, not this and a cloud service,
   not this on two machines for one account.
6. **Turn off your VPN.** Use the connection LinkedIn is used to seeing you on.
7. **Then press "I've done it — resume".**

If a second check arrives soon after the first, stop for a week rather than a day.

## What we will not build

We will not build anything that solves a CAPTCHA, passes a check on your behalf, or gets round one.
That rules out, specifically:

- CAPTCHA-solving services, whether human-powered or automated.
- Retrying the request that was challenged, straight away or after a delay.
- Switching to a different endpoint, a different route, or the page itself when the API is blocked.
- Rotating IP addresses, proxies, user agents or browser fingerprints.
- Importing cookies from somewhere else, or keeping a session alive that LinkedIn has ended.
- Clearing the pause automatically after some amount of time.

Two reasons.

**It is evasion of a security measure.** A check is LinkedIn's way of making sure the person at
the keyboard is the account holder. Software that answers it for you is defeating that on purpose.
This project automates your own account from your own session; it does not defeat the controls
around it, and that line is the one thing about the toolkit that is not up for discussion.

**It is how a warning becomes a ban.** A check is a question. Answering it yourself and then
easing off is the ordinary way through one. An account whose automation carries straight on — or
comes back seconds later from a new address with the puzzle mysteriously solved — has confirmed
exactly what the check was asking about. Stopping is the principled thing to do, and it is also
the thing most likely to leave you with an account.

If you want a tool that does these things, this is not it, and an issue asking for them will be
closed.

## I keep getting checks

Work down this list. The earlier items are the more likely.

- **Are you on a VPN, a proxy, or a network you do not usually use?** Turn it off, or go home.
- **Is another tool touching this account?** Another extension, a cloud automation service, a
  scraper, a second copy of this toolkit on another machine. Remove it. One tool per account.
- **Are your caps too high for this account?** Open Settings and look at the daily numbers. New
  and lightly used accounts should be at 10–15 invitations a day, not 25. See the table in
  [safety.md](safety.md#recommended-settings).
- **Is warm-up off?** Turn it on.
- **Are you viewing a lot of profiles?** Exports, research packs and `network.status` checks all
  spend profile views. Lower the daily visit cap, and export smaller batches.
- **Did you resume too soon?** The 24 hours is a minimum. After a second check, wait a week.
- **Is the account new, or has it been restricted before?** Use it by hand for a month before
  automating anything.
- **Is Autopilot on?** Put it back in Copilot, so nothing goes out without you approving it, until
  things have been quiet for a while.
- **Are you running at odd hours?** Keep the business-hours window on. Activity at 3am on an
  account that is otherwise nine-to-five stands out.
- **Did you press "I've done it — resume" without doing the check?** The next request will be
  challenged again. Open LinkedIn and look.

If none of that helps, stop automating that account. Some accounts are simply being watched more
closely than others, and no setting changes that.

## What we have not seen live

This matters, so it is written down rather than implied.

The redirect behaviour — an API call sent to `/checkpoint/challenge/…` and coming back as a `200`
HTML page — was found by reading the code and reasoning about how `fetch` handles a redirect. At
the time of writing, **nobody on this project has captured a live security check against an API
call**, because a check cannot be produced on demand and we will not try to provoke one.

So these are assumptions:

- The exact paths LinkedIn redirects to. `/checkpoint/challenge/…`, `/checkpoint/lg/…`,
  `/uas/login`, `/login`, `/m/login` and `/authwall` are the ones known from LinkedIn's website;
  there may be others.
- The wording on the check page. The phrases looked for are English ones LinkedIn's check pages
  are reported to use. A page in another language, or reworded, would not match them — though it
  would still be refused as "a web page instead of data" and never counted as a success.
- The JSON shapes (`challengeUrl`, `challenge_url`, a `403` body naming a challenge). These were
  written from a general understanding of how an API signals a check. They are not captures from
  the endpoints the toolkit calls, and LinkedIn may never send them.
- That the final address is visible at all. If LinkedIn answered a challenged API call with an
  opaque cross-origin redirect, the address would be hidden; the content-type and page-text rules
  exist for that case.

What does not depend on any of that: a response that is not a genuine JSON answer from the API is
never treated as a success, whatever it turns out to be.

If you hit a real check, please open an issue with the status code, the final URL's *path* (not
the query string — it contains tokens), the `content-type`, and whether the toolkit paused. That
is how these assumptions get replaced with facts.

## See also

- [safety.md](safety.md) — caps, pacing, warm-up, Copilot mode, recommended settings.
- [tools.md](tools.md#errors) — what each error code means to an agent.
