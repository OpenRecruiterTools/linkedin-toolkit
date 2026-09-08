/**
 * End to end against the real server in demo mode: `lit serve --http --fake`.
 *
 * This is not a mock. `--fake` attaches an in-process demo extension over the
 * real WebSocket bridge, so a call here travels the same path a real one does —
 * HTTP router, param validation, bridge frame, engine, envelope back. What it
 * cannot do is touch LinkedIn: the data is invented and no network call leaves
 * the machine.
 *
 * Skipped, not failed, when `mcp-server/dist` has not been built: this package
 * must be testable on its own.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinkedInToolkit, LinkedInToolkitError } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const cli = join(repoRoot, 'mcp-server', 'dist', 'cli.js');
const built = existsSync(cli);

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

async function waitFor(check: () => Promise<boolean>, budgetMs = 20_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error('The fake server never became ready.');
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe.skipIf(!built)('against `lit serve --http --fake`', () => {
  let child: ChildProcess;
  let client: LinkedInToolkit;
  let home: string;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'lit-fake-'));
    const httpPort = await freePort();
    const bridgePort = await freePort();

    child = spawn(
      process.execPath,
      [cli, 'serve', '--http', '--fake', '--port', String(httpPort), '--bridge-port', String(bridgePort)],
      { env: { ...process.env, LINKEDIN_TOOLKIT_HOME: home }, stdio: 'ignore' },
    );

    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${httpPort}/health`);
      if (!response.ok) return false;
      const health = (await response.json()) as { extensionConnected: boolean };
      return health.extensionConnected === true;
    });

    const token = (JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as { token: string }).token;
    client = new LinkedInToolkit({ baseUrl: `http://127.0.0.1:${httpPort}`, token });
  }, 60_000);

  afterAll(() => {
    child?.kill();
  });

  it('reports health with the demo extension attached', async () => {
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(health.extensionConnected).toBe(true);
  });

  it('returns a real status envelope', async () => {
    const status = await client.statusGet();
    expect(status.connected).toBe(true);
    expect(status.quotas.invite.dailyCap).toBeGreaterThan(0);
  });

  it('searches people and gets contract-shaped profiles back', async () => {
    const result = await client.searchPeople({ keywords: 'platform engineering', count: 5 });
    expect(Array.isArray(result.profiles)).toBe(true);
    expect(result.profiles.length).toBeGreaterThan(0);
    for (const profile of result.profiles) {
      expect(typeof profile.publicId).toBe('string');
      expect(typeof profile.fullName).toBe('string');
      expect(profile.url).toContain('linkedin.com');
    }
  });

  it('queues an invite rather than sending it — Copilot mode is the default', async () => {
    const search = await client.searchPeople({ keywords: 'platform engineering', count: 1 });
    const target = search.profiles[0].publicId;

    const result = await client.outreachInvite({ publicId: target, note: 'Enjoyed your talk.' });
    expect(result.status).toBe('queued');
    expect(typeof result.queueId).toBe('string');

    const queue = await client.queueList({ status: 'pending' });
    expect(queue.items.some((item) => item.id === result.queueId)).toBe(true);
  });

  it('previews a write with dry_run without queueing it', async () => {
    const before = await client.queueList({ status: 'pending' });
    const result = await client.outreachInvite({ publicId: 'anyone', dry_run: true });
    expect(result.status).toBe('dryRun');
    const after = await client.queueList({ status: 'pending' });
    expect(after.items.length).toBe(before.items.length);
  });

  it('reaches the server-local tools over /tools/{tool}', async () => {
    const synced = (await client.callTool('linkedin_sync', {})) as { counts: unknown };
    expect(synced.counts).toBeDefined();

    const sql = (await client.callTool('linkedin_query_sql', {
      sql: 'SELECT COUNT(*) AS n FROM profiles',
    })) as { columns: string[]; rows: unknown[]; rowCount: number };
    expect(sql.columns).toContain('n');
    expect(sql.rowCount).toBe(1);
    const first = sql.rows[0] as Record<string, unknown> | unknown[];
    const value = Array.isArray(first) ? first[0] : first.n;
    expect(Number(value)).toBeGreaterThanOrEqual(0);
  });

  it('rejects a bad token with UNAUTHORIZED', async () => {
    const wrong = new LinkedInToolkit({ baseUrl: client.baseUrl, token: 'not-the-token' });
    const error = (await wrong.statusGet().catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('rejects invalid params with INVALID_PARAMS from the server, not the client', async () => {
    const error = (await client
      .call('search.people', { keywords: 'x', count: 5000 } as never)
      .catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(error.code).toBe('INVALID_PARAMS');
  });
});
