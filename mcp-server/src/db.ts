/**
 * The local SQLite mirror.
 *
 * Everything the toolkit sees — sync pulls and the results of individual tool
 * calls — is upserted here so agents can count, filter and join with
 * `linkedin_query_sql` instead of re-scraping LinkedIn. The file lives at
 * `~/.linkedin-toolkit/toolkit.db` unless the config overrides it.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type SqlValue = string | number | null;

export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
};

export const ROW_CAP = 1000;
export const QUERY_TIMEOUT_MS = 5000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (
  public_id TEXT PRIMARY KEY,
  urn TEXT, url TEXT, first_name TEXT, last_name TEXT, full_name TEXT,
  headline TEXT, title TEXT, company TEXT, company_urn TEXT,
  location TEXT, industry TEXT, photo_url TEXT,
  connection_degree INTEGER, skills TEXT, experience TEXT, education TEXT,
  page_text TEXT, source TEXT, captured_at INTEGER, data TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
  universal_name TEXT PRIMARY KEY,
  urn TEXT, name TEXT, url TEXT, industry TEXT, size TEXT, hq TEXT,
  website TEXT, description TEXT, follower_count INTEGER,
  captured_at INTEGER, data TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS searches (
  search_id TEXT PRIMARY KEY,
  keywords TEXT, filters TEXT, source TEXT, total INTEGER,
  ran_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS search_results (
  search_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  position INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (search_id, public_id)
);
CREATE TABLE IF NOT EXISTS lists (
  list_id TEXT PRIMARY KEY,
  name TEXT, tags TEXT, created_at INTEGER, count INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS list_members (
  list_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  added_at INTEGER, tags TEXT, contacted_before INTEGER, signals TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (list_id, public_id)
);
CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id TEXT PRIMARY KEY,
  name TEXT, status TEXT, steps TEXT, settings TEXT, stats TEXT,
  created_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS enrollments (
  campaign_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  step_index INTEGER, status TEXT, enrolled_at INTEGER, next_at INTEGER,
  data TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, public_id)
);
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  action TEXT, public_id TEXT, campaign_id TEXT, status TEXT,
  params TEXT, result TEXT, at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  thread_id TEXT PRIMARY KEY,
  participants TEXT, last_message_at INTEGER, unread INTEGER,
  snippet TEXT, sentiment TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT, from_public_id TEXT, body TEXT, sent_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  event TEXT, payload TEXT, at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS packs (
  pack_id TEXT PRIMARY KEY,
  job_id TEXT, public_id TEXT, universal_name TEXT, kind TEXT,
  confidence REAL, signals TEXT, markdown TEXT, csv_row TEXT, data TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_company ON profiles(company);
CREATE INDEX IF NOT EXISTS idx_list_members_public ON list_members(public_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_packs_public ON packs(public_id);
`;

export const TABLES = [
  'profiles',
  'companies',
  'searches',
  'search_results',
  'lists',
  'list_members',
  'campaigns',
  'enrollments',
  'actions',
  'conversations',
  'messages',
  'events',
  'packs',
] as const;

export type TableName = (typeof TABLES)[number];

export type SyncPayload = {
  profiles?: any[];
  companies?: any[];
  lists?: any[];
  listMembers?: any[];
  campaigns?: any[];
  enrollments?: any[];
  actions?: any[];
  threads?: any[];
  messages?: any[];
  events?: any[];
  packs?: any[];
  searches?: any[];
};

export type UpsertCounts = Partial<Record<TableName, number>>;

const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
const bool = (v: unknown): number => (v ? 1 : 0);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export class Db {
  private readonly db: Database.Database;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /* --------------------------- meta ---------------------------- */

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, Date.now());
  }

  get lastSyncAt(): number {
    const raw = this.getMeta('lastSyncAt');
    return raw ? Number(raw) : 0;
  }

  set lastSyncAt(at: number) {
    this.setMeta('lastSyncAt', String(at));
  }

  /* ------------------------- upserts ---------------------------- */

  upsertProfile(profile: any, now = Date.now()): void {
    if (!profile || typeof profile.publicId !== 'string' || !profile.publicId) return;
    this.db
      .prepare(
        `INSERT INTO profiles (public_id, urn, url, first_name, last_name, full_name, headline,
           title, company, company_urn, location, industry, photo_url, connection_degree,
           skills, experience, education, page_text, source, captured_at, data, updated_at)
         VALUES (@public_id, @urn, @url, @first_name, @last_name, @full_name, @headline,
           @title, @company, @company_urn, @location, @industry, @photo_url, @connection_degree,
           @skills, @experience, @education, @page_text, @source, @captured_at, @data, @updated_at)
         ON CONFLICT(public_id) DO UPDATE SET
           urn=COALESCE(excluded.urn, profiles.urn),
           url=COALESCE(excluded.url, profiles.url),
           first_name=COALESCE(excluded.first_name, profiles.first_name),
           last_name=COALESCE(excluded.last_name, profiles.last_name),
           full_name=COALESCE(excluded.full_name, profiles.full_name),
           headline=COALESCE(excluded.headline, profiles.headline),
           title=COALESCE(excluded.title, profiles.title),
           company=COALESCE(excluded.company, profiles.company),
           company_urn=COALESCE(excluded.company_urn, profiles.company_urn),
           location=COALESCE(excluded.location, profiles.location),
           industry=COALESCE(excluded.industry, profiles.industry),
           photo_url=COALESCE(excluded.photo_url, profiles.photo_url),
           connection_degree=COALESCE(excluded.connection_degree, profiles.connection_degree),
           skills=COALESCE(excluded.skills, profiles.skills),
           experience=COALESCE(excluded.experience, profiles.experience),
           education=COALESCE(excluded.education, profiles.education),
           page_text=COALESCE(excluded.page_text, profiles.page_text),
           source=COALESCE(excluded.source, profiles.source),
           captured_at=COALESCE(excluded.captured_at, profiles.captured_at),
           data=excluded.data,
           updated_at=excluded.updated_at`,
      )
      .run({
        public_id: profile.publicId,
        urn: str(profile.urn),
        url: str(profile.url),
        first_name: str(profile.firstName),
        last_name: str(profile.lastName),
        full_name: str(profile.fullName),
        headline: str(profile.headline),
        title: str(profile.title),
        company: str(profile.company),
        company_urn: str(profile.companyUrn),
        location: str(profile.location),
        industry: str(profile.industry),
        photo_url: str(profile.photoUrl),
        connection_degree: num(profile.connectionDegree),
        skills: json(profile.skills),
        experience: json(profile.experience),
        education: json(profile.education),
        page_text: str(profile.pageText),
        source: str(profile.source),
        captured_at: num(profile.capturedAt),
        data: JSON.stringify(profile),
        updated_at: now,
      });
  }

  upsertCompany(company: any, now = Date.now()): void {
    if (!company || typeof company.universalName !== 'string' || !company.universalName) return;
    this.db
      .prepare(
        `INSERT INTO companies (universal_name, urn, name, url, industry, size, hq, website,
           description, follower_count, captured_at, data, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(universal_name) DO UPDATE SET
           urn=COALESCE(excluded.urn, companies.urn),
           name=COALESCE(excluded.name, companies.name),
           url=COALESCE(excluded.url, companies.url),
           industry=COALESCE(excluded.industry, companies.industry),
           size=COALESCE(excluded.size, companies.size),
           hq=COALESCE(excluded.hq, companies.hq),
           website=COALESCE(excluded.website, companies.website),
           description=COALESCE(excluded.description, companies.description),
           follower_count=COALESCE(excluded.follower_count, companies.follower_count),
           captured_at=COALESCE(excluded.captured_at, companies.captured_at),
           data=excluded.data,
           updated_at=excluded.updated_at`,
      )
      .run(
        company.universalName,
        str(company.urn),
        str(company.name),
        str(company.url),
        str(company.industry),
        str(company.size),
        str(company.hq),
        str(company.website),
        str(company.description),
        num(company.followerCount),
        num(company.capturedAt),
        JSON.stringify(company),
        now,
      );
  }

  upsertList(list: any, now = Date.now()): void {
    if (!list || typeof list.listId !== 'string') return;
    this.db
      .prepare(
        `INSERT INTO lists (list_id, name, tags, created_at, count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(list_id) DO UPDATE SET
           name=excluded.name, tags=excluded.tags, created_at=excluded.created_at,
           count=excluded.count, updated_at=excluded.updated_at`,
      )
      .run(list.listId, str(list.name), json(list.tags ?? []), num(list.createdAt), num(list.count), now);
  }

  upsertListMember(member: any, now = Date.now()): void {
    const listId = member?.listId;
    const publicId = member?.publicId ?? member?.profile?.publicId;
    if (typeof listId !== 'string' || typeof publicId !== 'string') return;
    if (member.profile) this.upsertProfile(member.profile, now);
    this.db
      .prepare(
        `INSERT INTO list_members (list_id, public_id, added_at, tags, contacted_before, signals, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(list_id, public_id) DO UPDATE SET
           added_at=excluded.added_at, tags=excluded.tags,
           contacted_before=excluded.contacted_before, signals=excluded.signals,
           updated_at=excluded.updated_at`,
      )
      .run(
        listId,
        publicId,
        num(member.addedAt),
        json(member.tags ?? []),
        bool(member.contactedBefore),
        json(member.signals ?? null),
        now,
      );
  }

  upsertCampaign(campaign: any, now = Date.now()): void {
    if (!campaign || typeof campaign.campaignId !== 'string') return;
    this.db
      .prepare(
        `INSERT INTO campaigns (campaign_id, name, status, steps, settings, stats, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id) DO UPDATE SET
           name=excluded.name, status=excluded.status, steps=excluded.steps,
           settings=excluded.settings, stats=excluded.stats,
           created_at=excluded.created_at, updated_at=excluded.updated_at`,
      )
      .run(
        campaign.campaignId,
        str(campaign.name),
        str(campaign.status),
        json(campaign.steps ?? []),
        json(campaign.settings ?? {}),
        json(campaign.stats ?? null),
        num(campaign.createdAt),
        now,
      );
  }

  upsertEnrollment(enrollment: any, now = Date.now()): void {
    if (
      typeof enrollment?.campaignId !== 'string' ||
      typeof enrollment?.publicId !== 'string'
    )
      return;
    this.db
      .prepare(
        `INSERT INTO enrollments (campaign_id, public_id, step_index, status, enrolled_at, next_at, data, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id, public_id) DO UPDATE SET
           step_index=excluded.step_index, status=excluded.status,
           enrolled_at=excluded.enrolled_at, next_at=excluded.next_at,
           data=excluded.data, updated_at=excluded.updated_at`,
      )
      .run(
        enrollment.campaignId,
        enrollment.publicId,
        num(enrollment.stepIndex),
        str(enrollment.status),
        num(enrollment.enrolledAt),
        num(enrollment.nextAt),
        JSON.stringify(enrollment),
        now,
      );
  }

  upsertAction(action: any, now = Date.now()): void {
    const id = action?.id ?? action?.actionId;
    if (typeof id !== 'string') return;
    this.db
      .prepare(
        `INSERT INTO actions (id, action, public_id, campaign_id, status, params, result, at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           action=excluded.action, public_id=excluded.public_id, campaign_id=excluded.campaign_id,
           status=excluded.status, params=excluded.params, result=excluded.result,
           at=excluded.at, updated_at=excluded.updated_at`,
      )
      .run(
        id,
        str(action.action),
        str(action.publicId),
        str(action.campaignId),
        str(action.status),
        json(action.params ?? null),
        json(action.result ?? null),
        num(action.at),
        now,
      );
  }

  upsertThread(thread: any, now = Date.now()): void {
    if (!thread || typeof thread.threadId !== 'string') return;
    this.db
      .prepare(
        `INSERT INTO conversations (thread_id, participants, last_message_at, unread, snippet, sentiment, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           participants=excluded.participants, last_message_at=excluded.last_message_at,
           unread=excluded.unread, snippet=excluded.snippet, sentiment=excluded.sentiment,
           updated_at=excluded.updated_at`,
      )
      .run(
        thread.threadId,
        json(thread.participants ?? []),
        num(thread.lastMessageAt),
        bool(thread.unread),
        str(thread.snippet),
        str(thread.sentiment),
        now,
      );
  }

  upsertMessage(message: any, now = Date.now()): void {
    if (!message || typeof message.messageId !== 'string') return;
    this.db
      .prepare(
        `INSERT INTO messages (message_id, thread_id, from_public_id, body, sent_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET
           thread_id=excluded.thread_id, from_public_id=excluded.from_public_id,
           body=excluded.body, sent_at=excluded.sent_at, updated_at=excluded.updated_at`,
      )
      .run(
        message.messageId,
        str(message.threadId),
        str(message.fromPublicId),
        str(message.body),
        num(message.sentAt),
        now,
      );
  }

  upsertEvent(event: any, now = Date.now()): void {
    const id =
      typeof event?.id === 'string'
        ? event.id
        : `${event?.event ?? 'event'}:${event?.at ?? now}:${JSON.stringify(event?.payload ?? {})}`;
    this.db
      .prepare(
        `INSERT INTO events (id, event, payload, at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           event=excluded.event, payload=excluded.payload, at=excluded.at,
           updated_at=excluded.updated_at`,
      )
      .run(id, str(event?.event), json(event?.payload ?? null), num(event?.at) ?? now, now);
  }

  upsertSearch(search: any, now = Date.now()): void {
    if (!search || typeof search.searchId !== 'string') return;
    this.db
      .prepare(
        `INSERT INTO searches (search_id, keywords, filters, source, total, ran_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(search_id) DO UPDATE SET
           keywords=excluded.keywords, filters=excluded.filters, source=excluded.source,
           total=excluded.total, ran_at=excluded.ran_at, updated_at=excluded.updated_at`,
      )
      .run(
        search.searchId,
        str(search.keywords),
        json(search.filters ?? null),
        str(search.source),
        num(search.total),
        num(search.ranAt) ?? now,
        now,
      );
    let position = 0;
    for (const profile of search.profiles ?? []) {
      this.upsertProfile(profile, now);
      this.db
        .prepare(
          `INSERT INTO search_results (search_id, public_id, position, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(search_id, public_id) DO UPDATE SET
             position=excluded.position, updated_at=excluded.updated_at`,
        )
        .run(search.searchId, profile.publicId, position++, now);
    }
  }

  upsertPack(pack: any, jobId: string | null = null, now = Date.now()): void {
    if (!pack) return;
    const publicId = pack.resolved?.publicId ?? pack.profile?.publicId ?? null;
    const universalName = pack.resolved?.universalName ?? pack.company?.universalName ?? null;
    const packId = `${jobId ?? 'pack'}:${publicId ?? universalName ?? JSON.stringify(pack.row ?? {})}`;
    if (pack.profile) this.upsertProfile(pack.profile, now);
    if (pack.company) this.upsertCompany(pack.company, now);
    this.db
      .prepare(
        `INSERT INTO packs (pack_id, job_id, public_id, universal_name, kind, confidence,
           signals, markdown, csv_row, data, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(pack_id) DO UPDATE SET
           job_id=excluded.job_id, public_id=excluded.public_id,
           universal_name=excluded.universal_name, kind=excluded.kind,
           confidence=excluded.confidence, signals=excluded.signals,
           markdown=excluded.markdown, csv_row=excluded.csv_row, data=excluded.data,
           updated_at=excluded.updated_at`,
      )
      .run(
        packId,
        jobId,
        publicId,
        universalName,
        str(pack.resolved?.kind),
        num(pack.resolved?.confidence),
        json(pack.signals ?? []),
        str(pack.markdown),
        json(pack.csvRow ?? {}),
        JSON.stringify(pack),
        now,
      );
  }

  /**
   * Apply a `sync.pull` payload. Idempotent: applying the same payload twice
   * leaves exactly the same rows.
   */
  upsertSync(payload: SyncPayload | null | undefined, now = Date.now()): UpsertCounts {
    const counts: UpsertCounts = {};
    if (!payload) return counts;

    const apply = <T>(table: TableName, rows: T[] | undefined, fn: (row: T) => void) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      for (const row of rows) fn(row);
      counts[table] = (counts[table] ?? 0) + rows.length;
    };

    const run = this.db.transaction(() => {
      apply('profiles', payload.profiles, (p) => this.upsertProfile(p, now));
      apply('companies', payload.companies, (c) => this.upsertCompany(c, now));
      apply('searches', payload.searches, (s) => this.upsertSearch(s, now));
      apply('lists', payload.lists, (l) => this.upsertList(l, now));
      apply('list_members', payload.listMembers, (m) => this.upsertListMember(m, now));
      apply('campaigns', payload.campaigns, (c) => this.upsertCampaign(c, now));
      apply('enrollments', payload.enrollments, (e) => this.upsertEnrollment(e, now));
      apply('actions', payload.actions, (a) => this.upsertAction(a, now));
      apply('conversations', payload.threads, (t) => this.upsertThread(t, now));
      apply('messages', payload.messages, (m) => this.upsertMessage(m, now));
      apply('events', payload.events, (e) => this.upsertEvent(e, now));
      apply('packs', payload.packs, (p) => this.upsertPack(p, null, now));
    });
    run();
    return counts;
  }

  /**
   * Mirror whatever a tool result happens to contain. Best effort and never
   * throws: a tool call must not fail because the mirror could not store it.
   */
  recordToolResult(action: string, data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const now = Date.now();
    const d = data as any;
    try {
      const run = this.db.transaction(() => {
        if (typeof d.publicId === 'string') this.upsertProfile(d, now);
        if (typeof d.universalName === 'string' && typeof d.name === 'string')
          this.upsertCompany(d, now);
        for (const p of d.profiles ?? []) this.upsertProfile(p, now);
        for (const e of d.engagers ?? []) this.upsertProfile(e, now);
        for (const c of d.companies ?? []) this.upsertCompany(c, now);
        for (const t of d.threads ?? []) this.upsertThread(t, now);
        for (const m of d.messages ?? []) this.upsertMessage(m, now);
        for (const l of d.lists ?? []) this.upsertList(l, now);
        for (const m of d.members ?? [])
          this.upsertListMember({ ...m, listId: m.listId ?? d.listId }, now);
        for (const c of d.campaigns ?? []) this.upsertCampaign(c, now);
        for (const p of d.packs ?? []) this.upsertPack(p, typeof d.jobId === 'string' ? d.jobId : null, now);
        for (const r of d.resolved ?? []) {
          for (const candidate of r?.candidates ?? []) this.upsertProfile(candidate, now);
        }
        if (typeof d.campaignId === 'string' && typeof d.name === 'string')
          this.upsertCampaign(d, now);
        if (typeof d.listId === 'string' && typeof d.name === 'string') this.upsertList(d, now);
        if (action === 'search.people' && Array.isArray(d.profiles)) {
          // keep a lightweight record of the search itself when the engine gave us one
          if (typeof d.searchId === 'string') this.upsertSearch(d, now);
        }
      });
      run();
    } catch {
      /* the mirror is a convenience, never a failure path */
    }
  }

  /* --------------------------- query ---------------------------- */

  /** Read-only SQL: one SELECT or WITH statement, 5 s budget, 1,000 rows. */
  query(sql: string, params: SqlValue[] = []): QueryResult {
    const trimmed = String(sql ?? '').trim().replace(/;\s*$/, '');
    if (!trimmed) throw new Error('Empty query.');
    if (trimmed.includes(';')) {
      throw new Error('Only a single statement is allowed.');
    }
    // Comments before the statement would let `--\nPRAGMA ...` or a block
    // comment hide the real verb from the check below, so they are refused
    // outright rather than stripped.
    if (/^(--|\/\*)/.test(trimmed)) {
      throw new Error('Comments are not allowed before the statement.');
    }
    if (!/^(select|with)\b/i.test(trimmed)) {
      throw new Error('Only read-only SELECT or WITH queries are allowed.');
    }

    // Defence in depth, in this order:
    //   1. the verb check above,
    //   2. a connection SQLite itself refuses writes on — a separate read-only
    //      handle for a file database, `query_only` for an in-memory one,
    //      whose single connection cannot be reopened read-only,
    //   3. `statement.readonly`, which is false for a writing statement that
    //      still returns rows, e.g. `WITH x AS (...) INSERT ... RETURNING *`.
    const inMemory = this.path === ':memory:';
    const readonlyDb = inMemory ? this.db : new Database(this.path, { readonly: true });
    if (inMemory) readonlyDb.pragma('query_only = ON');
    try {
      const statement = readonlyDb.prepare(trimmed);
      if (!statement.reader || !statement.readonly) {
        throw new Error('Only read-only SELECT or WITH queries are allowed.');
      }
      const deadline = Date.now() + QUERY_TIMEOUT_MS;
      const rows: Record<string, unknown>[] = [];
      let truncated = false;
      for (const row of statement.iterate(...params) as Iterable<Record<string, unknown>>) {
        if (rows.length >= ROW_CAP) {
          truncated = true;
          break;
        }
        if (Date.now() > deadline) {
          throw new Error(`Query exceeded the ${QUERY_TIMEOUT_MS}ms budget.`);
        }
        rows.push(row);
      }
      const columns = statement.columns().map((c) => c.name);
      return { columns, rows, rowCount: rows.length, truncated };
    } finally {
      if (inMemory) readonlyDb.pragma('query_only = OFF');
      else readonlyDb.close();
    }
  }

  /** Row counts for every table, for `lit status` and `linkedin_sync`. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const table of TABLES) {
      const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      out[table] = row.n;
    }
    return out;
  }
}

let shared: Db | null = null;

export function openDb(path: string): Db {
  if (shared && shared.path === path) return shared;
  shared?.close();
  shared = new Db(path);
  return shared;
}

export function closeSharedDb(): void {
  shared?.close();
  shared = null;
}
