# Transcript: sourcing run in Claude Code

A real shape of a run, edited only to shorten result payloads. Names are synthetic — this was run
against `lit serve --http --fake`.

---

**&gt;** Find me 20 heads of data engineering at Series B fintechs in London, check who I'm already connected to, and draft invites for the top 8.

I'll check the toolkit is connected first, then search.

**`linkedin_get_status`**

```json
{}
```

```json
{
  "connected": true,
  "extensionVersion": "2.0.0",
  "loggedIn": true,
  "autopilot": false,
  "businessHours": true,
  "quotas": {
    "invite": { "hourlyUsed": 0, "hourlyCap": 20, "dailyUsed": 6, "dailyCap": 100, "nextAllowedAt": 0 },
    "search": { "hourlyUsed": 0, "hourlyCap": 200, "dailyUsed": 0, "dailyCap": 1000, "nextAllowedAt": 0 },
    "visit":  { "hourlyUsed": 2, "hourlyCap": 60, "dailyUsed": 11, "dailyCap": 500, "nextAllowedAt": 0 },
    "message":{ "hourlyUsed": 0, "hourlyCap": 30, "dailyUsed": 0, "dailyCap": 150, "nextAllowedAt": 0 }
  },
  "queue": { "pending": 0 },
  "campaigns": { "active": 1, "paused": 0 }
}
```

Connected, logged in, plenty of headroom — 94 invites and 1,000 search results left today.
**Autopilot is off**, so anything I draft will queue for your approval rather than send.

Titles vary a lot for this role, so I'll run three queries instead of one.

**`linkedin_search_people`**

```json
{ "keywords": "data engineering fintech", "title": "Head of Data Engineering", "location": "London", "source": "search", "count": 50 }
```

```json
{ "profiles": [ /* 34 profiles */ ], "total": 34, "nextStart": null }
```

**`linkedin_search_people`**

```json
{ "keywords": "data platform fintech", "title": "Director of Data Engineering", "location": "London", "source": "search", "count": 50 }
```

```json
{ "profiles": [ /* 22 profiles */ ], "total": 22, "nextStart": null }
```

**`linkedin_search_people`**

```json
{ "keywords": "data platform payments", "title": "VP Data", "location": "London", "source": "search", "count": 50 }
```

```json
{ "profiles": [ /* 19 profiles */ ], "total": 19, "nextStart": null }
```

75 raw results. Let me check what's already in your lists so I don't hand you people you've
already worked.

**`linkedin_list_all`**

```json
{}
```

```json
{ "lists": [
  { "listId": "lst_3f8a", "name": "Data leaders Q2", "tags": ["sourced"], "count": 61, "createdAt": 1743000000000 },
  { "listId": "lst_91cd", "name": "Post engagers 14 Aug", "tags": ["intent"], "count": 143, "createdAt": 1755100000000 }
] }
```

**`linkedin_list_members`**

```json
{ "listId": "lst_3f8a", "start": 0, "count": 200 }
```

```json
{ "members": [ /* 61 members */ ], "total": 61 }
```

19 of the 75 are already in "Data leaders Q2". Dropping those, plus 12 duplicates across my three
queries and 6 who aren't actually in London. 38 left.

**`linkedin_get_connection_status`**

```json
{ "publicIds": ["arjun-mehta-data", "l-okafor", "sophie-brennan-7", "…38 total"] }
```

```json
{ "statuses": {
  "arjun-mehta-data": "connected",
  "l-okafor": "none",
  "sophie-brennan-7": "pending",
  "…": "…"
} }
```

4 connected, 3 invites already pending, 31 with no relationship. Scoring the 31 against your brief
— Series B, fintech, actually leading a team rather than an IC title.

**`linkedin_list_create`**

```json
{ "name": "Heads of Data Eng · London fintech · 2026-09-08", "tags": ["sourced", "data-eng", "london"] }
```

```json
{ "listId": "lst_c4d9", "name": "Heads of Data Eng · London fintech · 2026-09-08", "tags": ["sourced", "data-eng", "london"], "count": 0, "createdAt": 1757289600000 }
```

**`linkedin_list_add`**

```json
{ "listId": "lst_c4d9", "publicIds": ["l-okafor", "m-castellanos-eng", "…20 total"] }
```

```json
{ "added": 20, "duplicates": 0 }
```

Here's the shortlist. List `lst_c4d9`, 20 people.

| # | Name | Title | Company | Score | Why |
|---|------|-------|---------|-------|-----|
| 1 | Lola Okafor | Head of Data Engineering | Kestrel Pay | 94 | Series B payments, built the platform team from 3 to 19 |
| 2 | Miguel Castellanos | Director, Data Platform | Northbank | 91 | Ex-Monzo, two years in, owns the whole platform |
| 3 | Ruth Adeyemi | Head of Data | Tallow | 88 | Series B lending, hiring three data engineers now |
| 4 | Tom Halvorsen | VP Data | Perch | 86 | Series B, posted about their warehouse migration last week |
| 5 | Nadia Rahman | Head of Data Engineering | Fenwick Card | 84 | Cards, team of 12, five years in role |
| 6 | Chris Boland | Director of Data Engineering | Loop Treasury | 82 | Treasury tooling, Series B in March |
| 7 | Ines Varga | Head of Platform Data | Sable | 79 | Adjacent — platform rather than pure data |
| 8 | Femi Adeleke | Head of Data Engineering | Rill | 78 | Smaller than the rest but exactly the title |
| … | | | | | |

Now the invites for the top 8. Pulling full profiles first so the notes have something real in
them — this spends 8 profile visits from your daily 500.

**`linkedin_get_profile`**

```json
{ "publicId": "l-okafor", "full": true }
```

```json
{
  "publicId": "l-okafor",
  "fullName": "Lola Okafor",
  "headline": "Head of Data Engineering at Kestrel Pay · we're hiring",
  "company": "Kestrel Pay",
  "location": "London, United Kingdom",
  "experience": [{ "title": "Head of Data Engineering", "company": "Kestrel Pay", "start": "2023-04" }],
  "pageText": "…grew the platform team from 3 to 19… rebuilt ingestion on Flink…",
  "capturedAt": 1757289640000
}
```

*(seven more `linkedin_get_profile` calls)*

Drafted. Each note is under LinkedIn's 300-character limit and each one hangs on a fact from that
person's own profile. Let me dry-run the first one so you can see exactly what would go out.

**`linkedin_send_invite`**

```json
{
  "publicId": "l-okafor",
  "note": "Hi Lola — going from 3 to 19 on a platform team without the ingestion falling over is the part nobody writes about. I work with data leads at that exact stage. Happy to connect.",
  "dry_run": true
}
```

```json
{ "status": "dryRun", "wouldSend": { "publicId": "l-okafor", "note": "Hi Lola — going from 3 to 19…" } }
```

That's what would be sent. Queuing all eight.

**`linkedin_send_invite`** × 8

```json
{ "publicId": "l-okafor", "note": "Hi Lola — going from 3 to 19 on a platform team without the ingestion falling over is the part nobody writes about. I work with data leads at that exact stage. Happy to connect." }
```

```json
{ "status": "queued", "queueId": "q_7a1e" }
```

*(seven more, all `queued`)*

**`linkedin_queue_list`**

```json
{ "status": "pending" }
```

```json
{ "items": [
  { "id": "q_7a1e", "action": "outreach.invite", "origin": "mcp", "status": "pending", "createdAt": 1757289900000,
    "profile": { "publicId": "l-okafor", "fullName": "Lola Okafor", "company": "Kestrel Pay" },
    "params": { "publicId": "l-okafor", "note": "Hi Lola — going from 3 to 19…" } },
  { "id": "q_7a1f", "…": "…" }
] }
```

---

**Done.**

- **List** `lst_c4d9` — "Heads of Data Eng · London fintech · 2026-09-08", 20 people
- **Searched** 3 queries, 75 raw results, 19 already in your lists, 12 duplicates, 6 out of area
- **Skipped** 4 existing connections and 3 pending invites
- **Queued** 8 invites — **nothing has been sent**

**Autopilot is off**, so the eight invites are sitting in the extension popup's Queue tab. Open it
to approve, edit the note, or reject each one. Approving them from here instead:

```
linkedin_queue_approve { "ids": ["q_7a1e", "q_7a1f", …] }
```

Quota after this run, if you approve all eight: 14 of 100 invites today, 19 of 500 profile visits.

**&gt;** approve the first three, reject Ines Varga — she's platform not data

**`linkedin_queue_approve`**

```json
{ "ids": ["q_7a1e", "q_7a1f", "q_7a20"] }
```

```json
{ "approved": 3 }
```

**`linkedin_queue_reject`**

```json
{ "ids": ["q_7a24"] }
```

```json
{ "rejected": 1 }
```

Three approved — the engine will send them at human pace inside your business-hours window, not
all at once. Ines rejected. Four still pending; say the word when you've decided on those.
