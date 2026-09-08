/**
 * The Python client, end to end, against the real server binary.
 *
 * `clients/python` has its own unit tests (respx-mocked). They prove the client
 * builds the right requests; they cannot prove the server answers them. This
 * test installs the package into a throwaway virtualenv exactly as a user would
 * (`pip install -e clients/python`), spawns `node dist/cli.js serve --http
 * --fake` as a child process, and runs `scripts/python-smoke.py` against it.
 *
 * If Python is missing, too old, or a venv cannot be created (no network for
 * pip, a locked-down CI image), the suite skips with a message saying which —
 * a skip that names its reason is useful; a silent pass is not.
 *
 * Fake mode: no Chrome, no LinkedIn account, no network beyond 127.0.0.1 except
 * pip's own install.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const cli = resolve(repoRoot, 'mcp-server/dist/cli.js');
const pythonClient = resolve(repoRoot, 'clients/python');
const smokeScript = resolve(repoRoot, 'scripts/python-smoke.py');

/** The first interpreter on PATH that is Python 3.10 or newer. */
function findPython(): { command: string; args: string[]; version: string } | null {
  const candidates: [string, string[]][] = [
    ['python3', []],
    ['python', []],
    ['py', ['-3']],
  ];
  for (const [command, args] of candidates) {
    const probe = spawnSync(command, [...args, '--version'], { encoding: 'utf8' });
    if (probe.status !== 0) continue;
    const version = `${probe.stdout}${probe.stderr}`.trim();
    const match = version.match(/Python (\d+)\.(\d+)/);
    if (!match) continue;
    const [major, minor] = [Number(match[1]), Number(match[2])];
    if (major > 3 || (major === 3 && minor >= 10)) return { command, args, version };
  }
  return null;
}

const python = findPython();
const missing: string[] = [];
if (!python) missing.push('no Python 3.10+ on PATH');
if (!existsSync(pythonClient)) missing.push(`clients/python is not present at ${pythonClient}`);
if (!existsSync(smokeScript)) missing.push(`scripts/python-smoke.py is missing`);
if (!existsSync(cli)) missing.push('mcp-server/dist/cli.js is missing — run `npm run build -w mcp-server`');

let home: string;
let venvPython = '';
let child: ChildProcess | undefined;
let httpPort = 0;
let bridgePort = 0;
let token = '';
let serverOut = '';
/** Set when the environment exists but the install could not be done. */
let setupSkip: string | null = missing.length ? missing.join('; ') : null;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

type Run = { code: number | null; stdout: string; stderr: string };

function runProcess(command: string, args: string[], env: Record<string, string>): Promise<Run> {
  return new Promise((resolvePromise) => {
    const proc = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c));
    proc.stderr.on('data', (c) => (stderr += c));
    proc.on('error', (err) => resolvePromise({ code: -1, stdout, stderr: `${stderr}${err}` }));
    proc.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

/** Run the smoke script under the venv interpreter. */
function smoke(env: Record<string, string> = {}): Promise<Run> {
  return runProcess(venvPython, [smokeScript], { LINKEDIN_TOOLKIT_HOME: home, ...env });
}

async function waitForServer(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const body: any = await (await fetch(`http://127.0.0.1:${httpPort}/health`)).json();
      if (body.ok && body.extensionConnected) return;
      last = JSON.stringify(body);
    } catch (err) {
      last = String(err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server never became ready (last: ${last})\n${serverOut}`);
}

beforeAll(async () => {
  if (setupSkip) return;

  home = mkdtempSync(join(tmpdir(), 'lit-py-'));
  const venv = join(home, 'venv');

  // 1. A throwaway virtualenv, so nothing is installed into the user's Python.
  const created = spawnSync(python!.command, [...python!.args, '-m', 'venv', venv], {
    encoding: 'utf8',
  });
  venvPython =
    process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python');
  if (created.status !== 0 || !existsSync(venvPython)) {
    setupSkip = `could not create a virtualenv: ${created.stderr || created.stdout}`;
    return;
  }

  // 2. Install the client the way a user does. This needs the network for
  //    hatchling, httpx and pydantic; a locked-down machine skips here.
  const installed = spawnSync(
    venvPython,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '-e', pythonClient],
    { encoding: 'utf8', cwd: repoRoot, timeout: 300_000 },
  );
  if (installed.status !== 0) {
    setupSkip = `pip install -e clients/python failed: ${(installed.stderr || installed.stdout || '')
      .split('\n')
      .slice(-8)
      .join('\n')}`;
    return;
  }

  // 3. The real server binary, in fake mode.
  httpPort = await freePort();
  bridgePort = await freePort();
  child = spawn(
    process.execPath,
    [cli, 'serve', '--http', '--fake', '--port', String(httpPort), '--bridge-port', String(bridgePort)],
    { env: { ...process.env, LINKEDIN_TOOLKIT_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout?.on('data', (c) => (serverOut += c));
  child.stderr?.on('data', (c) => (serverOut += c));
  await waitForServer();

  token = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).token;
}, 420_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((r) => child!.once('exit', () => r()));
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('the Python client against a live server', () => {
  /** Every test needs the venv and the server; skip with the reason, not silently. */
  const guard = (ctx: { skip: () => void }): boolean => {
    if (setupSkip) {
      console.warn(`[e2e-python] skipped: ${setupSkip}`);
      ctx.skip();
      return true;
    }
    return false;
  };

  it('installs and imports as a package', async (ctx) => {
    if (guard(ctx)) return;
    const { code, stdout } = await runProcess(
      venvPython,
      ['-c', 'import linkedin_toolkit as t; print(t.__version__)'],
      {},
    );
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('2.0.0');
  });

  it('runs the whole smoke script and prints one JSON object', async (ctx) => {
    if (guard(ctx)) return;
    const { code, stdout, stderr } = await smoke();
    expect(code, `stderr:\n${stderr}`).toBe(0);

    const out = JSON.parse(stdout);
    expect(out.clientVersion).toBe('2.0.0');
    expect(out.baseUrl).toBe(`http://127.0.0.1:${httpPort}`);
    expect(out.health).toMatchObject({ ok: true, extensionConnected: true, version: '2.0.0' });
  });

  it('reads status through the client in contract shape', async (ctx) => {
    if (guard(ctx)) return;
    const { stdout } = await smoke();
    const { status } = JSON.parse(stdout);
    expect(status.connected).toBe(true);
    // The demo extension says so in its own version string, which is exactly
    // what it should do — a fake run must never be mistakable for a real one.
    expect(status.extensionVersion).toBe('2.0.0 (fake)');
    expect(status.loggedIn).toBe(true);
    expect(status.autopilot).toBe(false);
    expect(status.quotaKinds).toEqual(['invite', 'message', 'search', 'visit']);
    expect(typeof status.queuePending).toBe('number');
  });

  it('searches people and gets profiles back', async (ctx) => {
    if (guard(ctx)) return;
    const { stdout } = await smoke();
    const { search } = JSON.parse(stdout);
    expect(search.count).toBeGreaterThan(0);
    expect(search.count).toBeLessThanOrEqual(5);
    expect(typeof search.first.publicId).toBe('string');
    expect(search.first.url).toMatch(/linkedin\.com\/in\//);
  });

  it('previews an invite with dry_run and queues the real one', async (ctx) => {
    if (guard(ctx)) return;
    const { stdout } = await smoke();
    const out = JSON.parse(stdout);

    // dry_run travels all the way to the extension over /actions/{action},
    // where the contract schema would otherwise have stripped it.
    expect(out.inviteDryRun.status).toBe('dryRun');
    expect(out.inviteDryRun.wouldSend).toMatchObject({ publicId: out.search.first.publicId });

    // Copilot is the default, so the real call queues rather than sends.
    expect(out.invite.status).toBe('queued');
    expect(typeof out.invite.queueId).toBe('string');
    expect(out.queuePendingAfterInvite).toBeGreaterThan(out.status.queuePending);
  });

  it('surfaces UNAUTHORIZED as a typed error when the token is wrong', async (ctx) => {
    if (guard(ctx)) return;
    const { code, stderr } = await smoke({
      LINKEDIN_TOOLKIT_URL: `http://127.0.0.1:${httpPort}`,
      LINKEDIN_TOOLKIT_TOKEN: 'f'.repeat(32),
    });
    expect(code).not.toBe(0);
    expect(stderr).toContain('UNAUTHORIZED');
  });

  it('finds the server through LINKEDIN_TOOLKIT_URL and TOKEN as well', async (ctx) => {
    if (guard(ctx)) return;
    const elsewhere = mkdtempSync(join(tmpdir(), 'lit-py-nohome-'));
    try {
      const { code, stdout, stderr } = await smoke({
        LINKEDIN_TOOLKIT_HOME: elsewhere,
        LINKEDIN_TOOLKIT_URL: `http://127.0.0.1:${httpPort}`,
        LINKEDIN_TOOLKIT_TOKEN: token,
      });
      expect(code, `stderr:\n${stderr}`).toBe(0);
      expect(JSON.parse(stdout).status.connected).toBe(true);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('says the server is unreachable rather than hanging when it is not there', async (ctx) => {
    if (guard(ctx)) return;
    const dead = await freePort();
    const elsewhere = mkdtempSync(join(tmpdir(), 'lit-py-dead-'));
    try {
      const { code, stderr } = await smoke({
        LINKEDIN_TOOLKIT_HOME: elsewhere,
        LINKEDIN_TOOLKIT_URL: `http://127.0.0.1:${dead}`,
        LINKEDIN_TOOLKIT_TOKEN: token,
      });
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/lit serve|not running|unreachable|refused/i);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('leaves the server running after everything', async (ctx) => {
    if (guard(ctx)) return;
    expect(child!.exitCode).toBe(null);
    const health: any = await (await fetch(`http://127.0.0.1:${httpPort}/health`)).json();
    expect(health.ok).toBe(true);
  });
});
