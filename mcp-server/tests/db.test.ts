import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db, TABLES, ROW_CAP } from '../src/db.js';
import { defaultHandlers, ada, grace, acme, pack, thread, message } from './fixtures.js';

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lit-db-'));
  db = new Db(join(dir, 'toolkit.db'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const syncPayload = () => (defaultHandlers()['sync.pull'] as any)({}) as any;

describe('schema', () => {
  it('creates every contract table', () => {
    const counts = db.counts();
    expect(Object.keys(counts).sort()).toEqual([...TABLES].sort());
    for (const table of TABLES) expect(counts[table]).toBe(0);
  });
});

describe('upsertSync', () => {
  it('stores a sync.pull payload', () => {
    const counts = db.upsertSync(syncPayload());
    expect(counts.profiles).toBe(2);
    expect(db.counts().profiles).toBe(2);
    expect(db.counts().lists).toBe(1);
    expect(db.counts().list_members).toBe(1);
    expect(db.counts().campaigns).toBe(1);
    expect(db.counts().enrollments).toBe(1);
    expect(db.counts().actions).toBe(1);
    expect(db.counts().conversations).toBe(1);
    expect(db.counts().messages).toBe(1);
    expect(db.counts().events).toBe(1);
  });

  it('is idempotent: the same payload twice yields the same rows', () => {
    db.upsertSync(syncPayload());
    const first = db.counts();
    db.upsertSync(syncPayload());
    expect(db.counts()).toEqual(first);
  });

  it('updates rather than duplicates a changed profile', () => {
    db.upsertProfile(ada);
    db.upsertProfile({ ...ada, headline: 'Now something else' });
    const result = db.query('SELECT headline FROM profiles WHERE public_id = ?', [ada.publicId]);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].headline).toBe('Now something else');
  });

  it('never blanks a field that a later, thinner record omits', () => {
    db.upsertProfile(ada);
    db.upsertProfile({ publicId: ada.publicId, url: ada.url, fullName: ada.fullName, capturedAt: 1 });
    const row = db.query('SELECT location FROM profiles WHERE public_id = ?', [ada.publicId]).rows[0];
    expect(row.location).toBe(ada.location);
  });

  it('keeps updated_at on every table it writes', () => {
    db.upsertSync(syncPayload(), 1234);
    for (const table of ['profiles', 'lists', 'campaigns', 'conversations', 'messages']) {
      const row = db.query(`SELECT MIN(updated_at) AS m FROM ${table}`).rows[0];
      expect(row.m).toBe(1234);
    }
  });

  it('tolerates an empty or missing payload', () => {
    expect(db.upsertSync(undefined)).toEqual({});
    expect(db.upsertSync({})).toEqual({});
  });
});

describe('recordToolResult', () => {
  it('mirrors profiles returned by a search', () => {
    db.recordToolResult('search.people', { profiles: [ada, grace], total: 2 });
    expect(db.counts().profiles).toBe(2);
  });

  it('mirrors a single profile, a company, threads and packs', () => {
    db.recordToolResult('profile.get', ada);
    db.recordToolResult('company.get', acme);
    db.recordToolResult('inbox.threads', { threads: [thread] });
    db.recordToolResult('inbox.messages', { messages: [message] });
    db.recordToolResult('research.get', { jobId: 'job_1', packs: [pack] });
    const counts = db.counts();
    expect(counts.profiles).toBe(1);
    expect(counts.companies).toBe(1);
    expect(counts.conversations).toBe(1);
    expect(counts.messages).toBe(1);
    expect(counts.packs).toBe(1);
  });

  it('mirrors engagers as profiles', () => {
    db.recordToolResult('post.engagers', { engagers: [{ ...ada, reaction: 'like' }] });
    expect(db.counts().profiles).toBe(1);
  });

  it('never throws on junk', () => {
    expect(() => db.recordToolResult('profile.get', null)).not.toThrow();
    expect(() => db.recordToolResult('profile.get', 'nope')).not.toThrow();
    expect(() => db.recordToolResult('x', { profiles: [{ nope: true }] })).not.toThrow();
  });
});

describe('query', () => {
  beforeEach(() => {
    db.upsertSync(syncPayload());
  });

  it('runs a SELECT and names its columns', () => {
    const result = db.query('SELECT public_id, full_name FROM profiles ORDER BY public_id');
    expect(result.columns).toEqual(['public_id', 'full_name']);
    expect(result.rows.map((r) => r.public_id)).toEqual(['ada-lovelace', 'grace-hopper']);
    expect(result.truncated).toBe(false);
  });

  it('runs a WITH query', () => {
    const result = db.query('WITH p AS (SELECT * FROM profiles) SELECT COUNT(*) AS n FROM p');
    expect(result.rows[0].n).toBe(2);
  });

  it('binds parameters', () => {
    const result = db.query('SELECT full_name FROM profiles WHERE public_id = ?', ['grace-hopper']);
    expect(result.rows[0].full_name).toBe('Grace Hopper');
  });

  it('rejects DELETE, UPDATE, INSERT, DROP and PRAGMA', () => {
    for (const sql of [
      'DELETE FROM profiles',
      'UPDATE profiles SET full_name = "x"',
      "INSERT INTO profiles (public_id, updated_at) VALUES ('x', 1)",
      'DROP TABLE profiles',
      'PRAGMA table_info(profiles)',
    ]) {
      expect(() => db.query(sql)).toThrow(/read-only/i);
    }
    expect(db.counts().profiles).toBe(2);
  });

  it('rejects multiple statements', () => {
    expect(() => db.query('SELECT 1; DELETE FROM profiles')).toThrow(/single statement/i);
    expect(db.counts().profiles).toBe(2);
  });

  it('allows a single trailing semicolon', () => {
    expect(db.query('SELECT 1 AS n;').rows[0].n).toBe(1);
  });

  it('rejects an empty query', () => {
    expect(() => db.query('   ')).toThrow(/empty/i);
  });

  it('rejects a statement hidden behind a comment', () => {
    for (const sql of [
      '-- harmless\nPRAGMA table_info(profiles)',
      '/* harmless */ DELETE FROM profiles',
      '--\nSELECT 1',
    ]) {
      expect(() => db.query(sql)).toThrow();
    }
    expect(db.counts().profiles).toBe(2);
  });

  it('rejects ATTACH and DETACH', () => {
    expect(() => db.query("ATTACH DATABASE 'other.db' AS other")).toThrow(/read-only/i);
    expect(() => db.query('DETACH DATABASE other')).toThrow(/read-only/i);
  });

  it('rejects a CTE that writes', () => {
    expect(() =>
      db.query(
        "WITH x AS (SELECT 'hacked' AS n) INSERT INTO profiles (public_id, updated_at) SELECT n, 1 FROM x",
      ),
    ).toThrow(/read-only/i);
    expect(db.counts().profiles).toBe(2);
  });

  it('rejects a writing statement that returns rows via RETURNING', () => {
    // `statement.reader` is true here because RETURNING yields rows; only
    // `statement.readonly` catches it.
    expect(() =>
      db.query(
        "WITH x AS (SELECT 'hacked' AS n) INSERT INTO profiles (public_id, updated_at) SELECT n, 1 FROM x RETURNING public_id",
      ),
    ).toThrow(/read-only/i);
    expect(() => db.query("DELETE FROM profiles RETURNING public_id")).toThrow(/read-only/i);
    expect(db.counts().profiles).toBe(2);
  });

  it('caps results at 1,000 rows and flags truncation', () => {
    const result = db.query(
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 5000)
       SELECT x FROM n`,
    );
    expect(result.rowCount).toBe(ROW_CAP);
    expect(result.truncated).toBe(true);
  });
});

describe('an in-memory database, which has only one connection', () => {
  let memory: Db;

  beforeEach(() => {
    memory = new Db(':memory:');
    memory.upsertProfile(ada);
  });

  afterEach(() => memory.close());

  it('still answers reads', () => {
    expect(memory.query('SELECT public_id FROM profiles').rows[0].public_id).toBe(ada.publicId);
  });

  it('refuses every write, including ones that return rows', () => {
    for (const sql of [
      'DELETE FROM profiles',
      "WITH x AS (SELECT 'hacked' AS n) INSERT INTO profiles (public_id, updated_at) SELECT n, 1 FROM x",
      "WITH x AS (SELECT 'hacked' AS n) INSERT INTO profiles (public_id, updated_at) SELECT n, 1 FROM x RETURNING public_id",
      'PRAGMA table_info(profiles)',
      "ATTACH DATABASE 'other.db' AS other",
    ]) {
      expect(() => memory.query(sql)).toThrow();
    }
    expect(memory.counts().profiles).toBe(1);
  });

  it('leaves the connection writable for the mirror after a query', () => {
    memory.query('SELECT 1');
    memory.upsertProfile(grace);
    expect(memory.counts().profiles).toBe(2);
  });
});

describe('meta', () => {
  it('remembers the last sync timestamp', () => {
    expect(db.lastSyncAt).toBe(0);
    db.lastSyncAt = 42;
    expect(db.lastSyncAt).toBe(42);
  });
});
