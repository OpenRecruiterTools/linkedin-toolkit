/**
 * The other end-to-end test: the real built binaries, in real processes.
 *
 * `e2e.test.ts` wires the classes together in one process, which proves the
 * layers agree but not that what we ship runs. This one spawns
 * `node dist/cli.js serve --http --fake` exactly as a user would, then drives
 * it with further `node dist/cli.js ...` invocations and reads their stdout
 * and exit codes. It catches the things only a real process shows: a missing
 * shebang, an unbuilt `dist/`, a `dist/` that is stale, a native module that
 * will not load, an unhandled rejection that takes the server down.
 *
 * Fake mode means no Chrome, no LinkedIn account and no network beyond
 * 127.0.0.1.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../dist/cli.js');

let home: string;
let child: ChildProcess;
let httpPort: number;
let bridgePort: number;
let serverOut = '';

/** An ephemeral port, released before the CLI is told to use it. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

type Run = { code: number | null; stdout: string; stderr: string };

/** Run one `lit` command in its own process against the same home directory. */
function run(args: string[], env: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolvePromise) => {
    const proc = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, LINKEDIN_TOOLKIT_HOME: home, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => (stdout += chunk));
    proc.stderr.on('data', (chunk) => (stderr += chunk));
    proc.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

/** Poll /health until the spawned server answers, or give up loudly. */
async function waitForServer(timeoutMs = 20_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${httpPort}/health`);
      const body = await response.json();
      if (body.ok && body.extensionConnected) return body;
      last = JSON.stringify(body);
    } catch (err) {
      last = String(err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server never became ready (last: ${last})\n--- server output ---\n${serverOut}`);
}

beforeAll(async () => {
  expect(
    existsSync(cli),
    'dist/cli.js is missing — run `npm run build -w mcp-server` before the tests',
  ).toBe(true);

  home = mkdtempSync(join(tmpdir(), 'lit-fake-'));
  httpPort = await freePort();
  bridgePort = await freePort();

  child = spawn(
    process.execPath,
    [
      cli,
      'serve',
      '--http',
      '--fake',
      '--port',
      String(httpPort),
      '--bridge-port',
      String(bridgePort),
    ],
    {
      env: { ...process.env, LINKEDIN_TOOLKIT_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.on('data', (chunk) => (serverOut += chunk));
  child.stderr?.on('data', (chunk) => (serverOut += chunk));
  child.on('exit', (code, signal) => {
    serverOut += `\n[server exited: code=${code} signal=${signal}]`;
  });

  await waitForServer();
}, 60_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  rmSync(home, { recursive: true, force: true });
});

describe('lit serve --http --fake, spawned as a real process', () => {
  it('says plainly that it is fake and prints the pairing block', () => {
    expect(serverOut).toContain('FAKE MODE');
    expect(serverOut).toContain('no LinkedIn calls are made');
    expect(serverOut).toContain('Demo extension connected');
    expect(serverOut).toContain(`Listening on http://127.0.0.1:${httpPort}`);
  });

  it('wrote a runtime file naming the ports it actually bound', () => {
    const runtime = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8'));
    expect(runtime.httpPort).toBe(httpPort);
    expect(runtime.bridgePort).toBe(bridgePort);
    expect(runtime.pid).toBe(child.pid);
  });

  it('answers /health with the demo extension attached', async () => {
    const health = await (await fetch(`http://127.0.0.1:${httpPort}/health`)).json();
    expect(health).toMatchObject({ ok: true, extensionConnected: true, version: '2.0.0' });
  });

  it('serves an OpenAPI document without a token', async () => {
    const doc = await (await fetch(`http://127.0.0.1:${httpPort}/openapi.json`)).json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/actions/search.people']).toBeDefined();
  });
});

describe('the CLI against the spawned server', () => {
  it('lit status --json reports the connection, quotas and mode', async () => {
    const { code, stdout } = await run(['status', '--json']);
    expect(code).toBe(0);
    const status = JSON.parse(stdout);
    expect(status.connected).toBe(true);
    expect(status.loggedIn).toBe(true);
    expect(status.autopilot).toBe(false);
    expect(Object.keys(status.quotas).sort()).toEqual(['invite', 'message', 'search', 'visit']);
  });

  it('lit status without --json prints a readable block', async () => {
    const { code, stdout } = await run(['status']);
    expect(code).toBe(0);
    expect(stdout).toContain('Server:    running');
    expect(stdout).toContain('Extension: connected');
    expect(stdout).toMatch(/Mode:\s+Copilot/);
  });

  it('lit search --json returns demo profiles in contract shape', async () => {
    const { code, stdout } = await run(['search', 'platform engineering', '--count', '5', '--json']);
    expect(code).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data.profiles)).toBe(true);
    expect(data.profiles.length).toBeGreaterThan(0);
    expect(data.profiles.length).toBeLessThanOrEqual(5);
    for (const profile of data.profiles) {
      expect(typeof profile.publicId).toBe('string');
      expect(typeof profile.fullName).toBe('string');
      expect(profile.url).toMatch(/linkedin\.com\/in\//);
    }
  });

  it('lit search --csv writes a header row and one line per profile', async () => {
    const file = join(home, 'search.csv');
    const { code, stdout } = await run(['search', 'platform', '--count', '3', '--csv', file]);
    expect(code).toBe(0);
    expect(stdout).toContain('Wrote');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines[0]).toContain('publicId');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('lit queue --json lists the demo queue in contract shape', async () => {
    const { code, stdout } = await run(['queue', '--json']);
    expect(code).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
    for (const item of data.items) {
      expect(item.status).toBe('pending');
      expect(typeof item.id).toBe('string');
      expect(['popup', 'campaign', 'mcp', 'cli']).toContain(item.origin);
    }
  });

  it('lit queue approve <id> approves exactly that item', async () => {
    const before = JSON.parse((await run(['queue', '--json'])).stdout);
    const id = before.items[0].id;

    const approved = await run(['queue', 'approve', id]);
    expect(approved.code).toBe(0);
    expect(approved.stdout).toContain('Approved 1');

    const after = JSON.parse((await run(['queue', '--json'])).stdout);
    expect(after.items.map((i: any) => i.id)).not.toContain(id);
    expect(after.items).toHaveLength(before.items.length - 1);
  });

  it('lit sync --json fills the mirror and lit sql --json reads it back', async () => {
    const synced = await run(['sync', '--json']);
    expect(synced.code).toBe(0);
    const sync = JSON.parse(synced.stdout);
    expect(sync.counts.profiles).toBeGreaterThan(0);
    expect(sync.totals.profiles).toBeGreaterThan(0);

    const queried = await run(['sql', 'SELECT COUNT(*) AS n FROM profiles', '--json']);
    expect(queried.code).toBe(0);
    const rows = JSON.parse(queried.stdout);
    expect(rows.columns).toEqual(['n']);
    expect(rows.rows[0].n).toBe(sync.totals.profiles);
    expect(rows.truncated).toBe(false);
  });

  it('lit sql refuses a statement that writes, and exits non-zero', async () => {
    const { code, stderr } = await run(['sql', 'DELETE FROM profiles']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/SELECT|read-only|single/i);
  });

  it('lit research builds packs on disk from a CSV', async () => {
    const input = join(home, 'rows.csv');
    writeFileSync(input, 'name,company\nAda Placeholder,Northwind Example\n', 'utf8');
    const out = join(home, 'packs');

    const { code, stdout } = await run(['research', input, '--out', out, '--poll', '100']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/packs/);
    expect(existsSync(join(out, 'output.csv'))).toBe(true);
  }, 60_000);

  it('lit export --table writes the mirror to CSV', async () => {
    const file = join(home, 'profiles.csv');
    const { code, stdout } = await run(['export', '--table', 'profiles', '--csv', file]);
    expect(code).toBe(0);
    expect(stdout).toContain('rows from profiles');
    expect(readFileSync(file, 'utf8').split('\n').length).toBeGreaterThan(1);
  });

  it('exits 1 with the pairing hint when no server is running', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'lit-none-'));
    try {
      const { code, stderr } = await run(['status'], { LINKEDIN_TOOLKIT_HOME: elsewhere });
      expect(code).toBe(1);
      expect(stderr).toContain('lit serve --http');
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('exits non-zero on an unknown command', async () => {
    const { code } = await run(['definitely-not-a-command']);
    expect(code).not.toBe(0);
  });

  it('the server is still up after every one of those', async () => {
    expect(child.exitCode).toBe(null);
    const health = await (await fetch(`http://127.0.0.1:${httpPort}/health`)).json();
    expect(health.ok).toBe(true);
  });
});
