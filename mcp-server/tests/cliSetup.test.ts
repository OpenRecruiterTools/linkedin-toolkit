/**
 * `lit setup` as a user meets it: one command, four steps, and a transcript
 * that has to be honest about each one.
 *
 * Every dependency is injected — no network, no Chrome, no listening socket,
 * and a temporary home directory — so this is the whole flow without any of
 * the things that would make it flaky.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, runSetup, type Io, type SetupDeps } from '../src/cli.js';
import { extensionZipUrl } from '../src/setup.js';
import { extensionZip } from './zipFixture.js';

let home: string;
let cwd: string;
let previousHome: string | undefined;
let out: string[];
let err: string[];

const io: Io = {
  out: (text) => out.push(text),
  err: (text) => err.push(text),
};
const stdout = () => out.join('\n');

beforeEach(() => {
  out = [];
  err = [];
  previousHome = process.env.LINKEDIN_TOOLKIT_HOME;
  home = mkdtempSync(join(tmpdir(), 'lit-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'lit-cwd-'));
  process.env.LINKEDIN_TOOLKIT_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.LINKEDIN_TOOLKIT_HOME;
  else process.env.LINKEDIN_TOOLKIT_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

/** A fetch that serves the real bytes of an extension zip for one version. */
function zipFetch(version = '2.0.4'): typeof fetch {
  const zip = extensionZip(version);
  return (async (input: any) => {
    if (String(input) !== extensionZipUrl(version)) {
      return { ok: false, status: 404, json: async () => null } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
    } as unknown as Response;
  }) as typeof fetch;
}

/** A paired server, a never-paired server, or one that pairs on the Nth poll. */
function fakeServer(options: { pairsAfter?: number; startedHere?: boolean } = {}) {
  let polls = 0;
  const stopped = { count: 0 };
  return {
    stopped,
    open: async () => ({
      url: 'http://127.0.0.1:47830',
      startedHere: options.startedHere ?? true,
      connected: async () => ++polls > (options.pairsAfter ?? 0),
      stop: async () => {
        stopped.count++;
      },
    }),
  };
}

function deps(extra: Partial<SetupDeps> = {}): SetupDeps {
  const server = fakeServer();
  // A clock that moves on every read, so a wait loop with an instant `sleep`
  // still reaches its deadline instead of spinning.
  let clock = Date.parse('2026-09-18T14:22:05.000Z');
  return {
    fetchImpl: zipFetch(),
    now: () => (clock += 500),
    cwd,
    home,
    platform: 'linux',
    env: { ...process.env, LINKEDIN_TOOLKIT_HOME: home },
    exists: () => false,
    launch: () => true,
    sleep: async () => undefined,
    openServer: server.open,
    ...extra,
  };
}

describe('lit setup', () => {
  it('installs the extension, pairs, and prints a snippet when no client is named', async () => {
    await runSetup({ version: '2.0.4', wait: 5 }, io, deps());

    const text = stdout();
    expect(text).toContain('[1/4] Extension');
    expect(text).toContain('Unpacked 4 files (extension v2.0.4)');
    expect(existsSync(join(home, 'extension', 'manifest.json'))).toBe(true);

    expect(text).toContain('chrome://extensions');
    expect(text).toContain('Load unpacked');
    expect(text).toContain(join(home, 'extension'));

    expect(text).toContain('Paired.');
    expect(text).toContain('"linkedin-toolkit"');
  });

  it('never claims Chrome opened a page it may have ignored', async () => {
    await runSetup(
      { version: '2.0.4', wait: 0 },
      io,
      deps({ platform: 'darwin', launch: () => true }),
    );
    expect(stdout()).toContain('Asked Chrome to open that page');
    expect(stdout()).toMatch(/if no tab appeared, type it in the address bar/);
    expect(stdout()).not.toMatch(/opened chrome:\/\/extensions\./i);
  });

  it('says why it is not touching Chrome when it cannot find one', async () => {
    await runSetup({ version: '2.0.4', wait: 0 }, io, deps({ platform: 'linux', exists: () => false }));
    expect(stdout()).toMatch(/Not opening Chrome for you: no Chrome or Chromium binary/);
  });

  it('honours --no-open', async () => {
    let launched = 0;
    await runSetup(
      { version: '2.0.4', wait: 0, open: false },
      io,
      deps({
        launch: () => {
          launched++;
          return true;
        },
      }),
    );
    expect(launched).toBe(0);
    expect(stdout()).toContain('--no-open');
  });

  it('reports a pairing timeout plainly, and stops the server it started', async () => {
    const server = fakeServer({ pairsAfter: 999 });
    await runSetup({ version: '2.0.4', wait: 3 }, io, deps({ openServer: server.open }));
    expect(stdout()).toContain('Not paired after 3s');
    expect(stdout()).toContain('lit serve --http');
    expect(server.stopped.count).toBe(1);
  });

  it('waits for a late pairing rather than giving up on the first poll', async () => {
    const server = fakeServer({ pairsAfter: 3 });
    await runSetup({ version: '2.0.4', wait: 30 }, io, deps({ openServer: server.open }));
    expect(stdout()).toContain('Paired.');
  });

  it('skips the wait entirely with --wait 0', async () => {
    const server = fakeServer();
    await runSetup({ version: '2.0.4', wait: 0 }, io, deps({ openServer: server.open }));
    expect(stdout()).toContain('--wait 0');
    expect(server.stopped.count).toBe(0);
  });

  it('writes the Claude Code config into the project, keeping other servers', async () => {
    writeFileSync(
      join(cwd, '.mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'docker' } } }, null, 2),
    );
    await runSetup({ version: '2.0.4', wait: 0, client: 'claude-code' }, io, deps());

    const written = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
    expect(written.mcpServers.github).toEqual({ command: 'docker' });
    expect(written.mcpServers['linkedin-toolkit']).toEqual({
      command: 'npx',
      args: ['-y', 'linkedin-toolkit-mcp'],
    });
    expect(stdout()).toContain('Backed the old one up to');
    expect(stdout()).toContain('Your other MCP servers are untouched: github');
    expect(readdirSync(cwd).some((name) => name.includes('.bak-'))).toBe(true);
  });

  it('writes VS Code\'s workspace file with its own shape', async () => {
    await runSetup({ version: '2.0.4', wait: 0, client: 'vscode' }, io, deps());
    const written = JSON.parse(readFileSync(join(cwd, '.vscode', 'mcp.json'), 'utf8'));
    expect(written.servers['linkedin-toolkit'].type).toBe('stdio');
  });

  it('prints for n8n instead of writing, and says why', async () => {
    await runSetup({ version: '2.0.4', wait: 0, client: 'n8n' }, io, deps());
    expect(stdout()).toContain('no file to write');
    expect(stdout()).toContain('MCP Client Tool node');
    expect(readdirSync(cwd)).toEqual([]);
  });

  it('refuses an unknown client and lists the real ones', async () => {
    await expect(
      runSetup({ version: '2.0.4', wait: 0, client: 'emacs' }, io, deps()),
    ).rejects.toThrow(/is not a client/);
  });

  it('refuses to rewrite a config file it cannot parse', async () => {
    writeFileSync(join(cwd, '.mcp.json'), '{ half a file');
    await expect(
      runSetup({ version: '2.0.4', wait: 0, client: 'claude-code' }, io, deps()),
    ).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(join(cwd, '.mcp.json'), 'utf8')).toBe('{ half a file');
  });

  it('writes nothing in a dry run — no extension, no config, no server', async () => {
    const server = fakeServer();
    await runSetup(
      { version: '2.0.4', wait: 30, dryRun: true, client: 'claude-code' },
      io,
      deps({ openServer: server.open }),
    );
    expect(existsSync(join(home, 'extension'))).toBe(false);
    expect(readdirSync(cwd)).toEqual([]);
    expect(server.stopped.count).toBe(0);
    expect(stdout()).toContain('dry run');
    expect(stdout()).toContain(`Would install version 2.0.4 into ${join(home, 'extension')}`);
    expect(stdout()).toContain(`Would create ${join(cwd, '.mcp.json')}`);
  });

  it('unpacks wherever --dir says', async () => {
    const elsewhere = join(cwd, 'tools', 'toolkit-extension');
    await runSetup({ version: '2.0.4', wait: 0, dir: elsewhere }, io, deps());
    expect(existsSync(join(elsewhere, 'manifest.json'))).toBe(true);
    expect(stdout()).toContain(elsewhere);
  });

  it('turns a failed download into one sentence, not a stack trace', async () => {
    const failing = (async () =>
      ({ ok: false, status: 500, json: async () => null }) as unknown as Response) as typeof fetch;
    await expect(
      runSetup({ version: '2.0.4', wait: 0 }, io, deps({ fetchImpl: failing })),
    ).rejects.toThrow(/GitHub answered 500|no linkedin-toolkit-extension zip/);
  });

  it('is in the help, with every flag', async () => {
    expect(await run(['setup', '--help'], io)).toBe(0);
    const text = stdout();
    for (const flag of ['--dir', '--no-open', '--dry-run', '--client', '--version', '--wait']) {
      expect(text).toContain(flag);
    }
    expect(text).toContain('claude-desktop');
    expect(text).toContain('n8n');
  });

  it('is offered by the top-level help as the first command', async () => {
    await run(['--help'], io);
    expect(stdout()).toContain('setup');
  });
});
