/**
 * `lit serve --fake`: the demo mode that lets someone try the toolkit with no
 * Chrome extension, no LinkedIn account and no network calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, serve, type ServeHandles } from '../src/cli.js';
import {
  FAKE_BANNER,
  FAKE_PROFILES,
  FAKE_COMPANIES,
  FAKE_RESEARCH_ROWS,
  createDemoHandlers,
} from '../src/fake-data.js';

let handles: ServeHandles | null = null;
let home: string;
let previousHome: string | undefined;
let out: string[];
let err: string[];

const io = {
  out: (text: string) => out.push(text),
  err: (text: string) => err.push(text),
};

const stdout = () => out.join('\n');

beforeEach(() => {
  out = [];
  err = [];
  previousHome = process.env.LINKEDIN_TOOLKIT_HOME;
  home = mkdtempSync(join(tmpdir(), 'lit-fake-'));
  process.env.LINKEDIN_TOOLKIT_HOME = home;
});

afterEach(async () => {
  await handles?.stop();
  handles = null;
  if (previousHome === undefined) delete process.env.LINKEDIN_TOOLKIT_HOME;
  else process.env.LINKEDIN_TOOLKIT_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

async function startFake(): Promise<void> {
  handles = await serve({ http: true, port: 0, bridgePort: 0, fake: true }, io);
  out = [];
}

describe('the demo dataset', () => {
  it('has the documented shape', () => {
    expect(FAKE_PROFILES).toHaveLength(25);
    expect(FAKE_COMPANIES.length).toBeGreaterThanOrEqual(10);
    expect(FAKE_RESEARCH_ROWS).toHaveLength(3);
  });

  it('gives every profile a complete, unique record', () => {
    const ids = FAKE_PROFILES.map((profile) => profile.publicId);
    expect(new Set(ids).size).toBe(25);
    for (const profile of FAKE_PROFILES) {
      expect(profile.publicId).toMatch(/^[a-z0-9-]+$/);
      expect(profile.url).toBe(`https://www.linkedin.com/in/${profile.publicId}/`);
      expect(profile.fullName).toBe(`${profile.firstName} ${profile.lastName}`);
      expect(profile.company).toBeTruthy();
      expect(profile.location).toBeTruthy();
      expect([1, 2, 3]).toContain(profile.connectionDegree);
    }
  });

  it('points every company at an example domain, never a real one', () => {
    for (const company of FAKE_COMPANIES) {
      expect(company.website).toMatch(/\.example$/);
      expect(company.description).toContain('fictional');
    }
  });

  it('starts with 3 lists, 2 campaigns, 3 pending queue items and 4 inbox threads', async () => {
    const handlers = createDemoHandlers(() => undefined);
    expect((await handlers['list.getAll']({})).lists).toHaveLength(3);
    expect((await handlers['campaign.getAll']({})).campaigns).toHaveLength(2);
    expect((await handlers['queue.list']({ status: 'pending' })).items).toHaveLength(3);
    expect((await handlers['inbox.threads']({})).threads).toHaveLength(4);
  });

  it('answers every action the contract defines', async () => {
    const { ACTIONS } = await import('../src/contract.js');
    const handlers = createDemoHandlers(() => undefined);
    const missing = ACTIONS.filter((action) => typeof handlers[action] !== 'function');
    expect(missing).toEqual([]);
  });
});

describe('lit serve --http --fake', () => {
  it('prints the fake-mode banner', async () => {
    handles = await serve({ http: true, port: 0, bridgePort: 0, fake: true }, io);
    expect(stdout()).toContain(FAKE_BANNER);
    expect(stdout()).toContain('Demo extension connected');
  });

  it('reports the demo extension as connected on /health', async () => {
    await startFake();
    const response = await fetch(`${handles!.http!.url}/health`);
    await expect(response.json()).resolves.toMatchObject({ ok: true, extensionConnected: true });
  });

  it('serves lit status from the demo data', async () => {
    await startFake();
    const code = await run(['status'], io);
    expect(code).toBe(0);
    expect(stdout()).toContain('Extension: connected (v2.0.0 (fake))');
    expect(stdout()).toContain('Copilot');
    expect(stdout()).toContain('Queue:     3 pending');
    expect(stdout()).toContain('Campaigns: 1 active, 1 paused');
  });

  it('serves lit search x --json from the demo data', async () => {
    await startFake();
    const code = await run(['search', 'x', '--json'], io);
    expect(code).toBe(0);
    const data = JSON.parse(stdout());
    expect(data.profiles.length).toBeGreaterThan(0);
    expect(data.total).toBe(data.profiles.length);
    expect(data.profiles[0]).toMatchObject({
      publicId: expect.any(String),
      fullName: expect.any(String),
      company: expect.any(String),
    });
    // Everything returned comes from the bundled dataset.
    const known = new Set(FAKE_PROFILES.map((profile) => profile.publicId));
    expect(data.profiles.every((profile: any) => known.has(profile.publicId))).toBe(true);
  });

  it('matches on headline as well as name', async () => {
    await startFake();
    await run(['search', 'engineering', '--count', '100', '--json'], io);
    const data = JSON.parse(stdout());
    expect(data.profiles.length).toBeGreaterThan(1);
    expect(
      data.profiles.every((profile: any) =>
        `${profile.fullName} ${profile.headline}`.toLowerCase().includes('engineering'),
      ),
    ).toBe(true);
  });

  it('filters a search that matches, and never returns nothing for a demo', async () => {
    await startFake();
    await run(['search', 'Berlin', '--json'], io);
    const berlin = JSON.parse(stdout());
    expect(berlin.profiles.every((p: any) => p.location.includes('Berlin'))).toBe(true);

    // A demo must never come back empty, so an unmatched keyword falls back to
    // the whole dataset rather than showing a reviewer a blank table.
    out = [];
    await run(['search', 'zzzz-no-such-thing', '--count', '100', '--json'], io);
    expect(JSON.parse(stdout()).profiles).toHaveLength(25);
  });
});

describe('fake mode writes', () => {
  it('queue rather than send, and land in the queue', async () => {
    await startFake();
    await run(['invite', FAKE_PROFILES[6].publicId, '--note', 'Hello there'], io);
    expect(stdout()).toContain('Queued for approval');

    out = [];
    await run(['queue', '--json'], io);
    const items = JSON.parse(stdout()).items;
    expect(items.length).toBe(4); // the 3 seeded plus the one just made
    expect(items.at(-1)).toMatchObject({
      action: 'outreach.invite',
      status: 'pending',
      params: { note: 'Hello there' },
    });
  });

  it('still honour dry_run without queueing', async () => {
    await startFake();
    await run(['invite', FAKE_PROFILES[0].publicId, '--dry-run'], io);
    expect(stdout()).toContain('dryRun');

    out = [];
    await run(['queue', '--json'], io);
    expect(JSON.parse(stdout()).items).toHaveLength(3);
  });

  it('let a queued item be approved', async () => {
    await startFake();
    await run(['queue', 'approve', 'q_pending_1'], io);
    expect(stdout()).toContain('Approved 1');

    out = [];
    await run(['queue', '--json'], io);
    const pending = JSON.parse(stdout()).items.filter((i: any) => i.status === 'pending');
    expect(pending).toHaveLength(2);
  });
});

describe('fake mode end to end', () => {
  it('syncs the demo data into SQLite and answers SQL over it', async () => {
    await startFake();
    await run(['sync'], io);
    expect(stdout()).toContain('profiles: 25');

    out = [];
    await run(['sql', 'SELECT COUNT(*) AS n FROM profiles'], io);
    expect(stdout()).toContain('25');

    out = [];
    await run(['sql', "SELECT company, COUNT(*) AS n FROM profiles GROUP BY company ORDER BY n DESC"], io);
    expect(stdout()).toContain('Northwind Robotics');
  });

  it('lists the demo lists and campaigns', async () => {
    await startFake();
    await run(['campaign', 'list'], io);
    expect(stdout()).toContain('camp_platform_intro');
    expect(stdout()).toContain('paused');
  });

  it('triages the demo inbox', async () => {
    await startFake();
    await run(['inbox', '--sentiment'], io);
    expect(stdout()).toContain('positive');
    expect(stdout()).toContain('negative');
  });

  it('writes research packs for three rows', async () => {
    await startFake();
    const input = join(home, 'rows.csv');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      input,
      ['name,company', ...FAKE_RESEARCH_ROWS.map((row) => `${row.name},${row.company ?? ''}`)].join(
        '\n',
      ),
      'utf8',
    );
    const outDir = join(home, 'packs');
    const code = await run(['research', input, '--out', outDir, '--poll', '20'], io);
    expect(code).toBe(0);
    expect(stdout()).toContain('3/3 packs');
    expect(existsSync(join(outDir, 'output.csv'))).toBe(true);

    const packDir = join(outDir, FAKE_PROFILES[0].publicId);
    expect(readFileSync(join(packDir, 'pack.md'), 'utf8')).toContain(FAKE_PROFILES[0].fullName);
    expect(JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8')).signals.length).toBeGreaterThan(0);
  });
});

describe('--fake in the help', () => {
  it('is documented on serve', async () => {
    await run(['serve', '--help'], io);
    expect(stdout()).toContain('--fake');
    expect(stdout()).toContain('no LinkedIn account');
  });
});
