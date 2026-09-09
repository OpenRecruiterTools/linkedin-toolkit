/**
 * The package binary, spawned the way a client actually launches it.
 *
 * `cli.test.ts` calls `run(['--help'])` in-process, which proves the argument
 * parsing but not what `npx linkedin-toolkit-mcp --help` does: that path goes
 * through `dist/server.js`, which must print the explanation and the usage and
 * then *stop*, rather than quietly starting a bridge and waiting forever on
 * stdin. The other half of the same question is that the binary with no
 * arguments really is an MCP server, so it is asked to `initialize` here.
 *
 * Everything runs against a throwaway `LINKEDIN_TOOLKIT_HOME`, so neither test
 * reads or writes the developer's own `~/.linkedin-toolkit`, and the bridge
 * binds a port the kernel has just confirmed is free rather than the default
 * 47829, which a developer may well be using.
 */
import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_NAME } from '../src/tools.js';
import { closedPort, TEST_TOKEN } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const binary = resolve(here, '../dist/server.js');

function requireBuild(): void {
  expect(
    existsSync(binary),
    'dist/server.js is missing — run `npm run build -w mcp-server` before the tests',
  ).toBe(true);
}

/** A home directory with a config the binary can load without inventing one. */
async function isolatedHome(): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), 'lit-binary-'));
  writeFileSync(
    join(home, 'config.json'),
    `${JSON.stringify(
      {
        token: TEST_TOKEN,
        bridgePort: await closedPort(),
        httpPort: await closedPort(),
        dbPath: join(home, 'toolkit.db'),
        researchTimeoutMs: 2000,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return home;
}

type Run = { code: number | null; stdout: string; stderr: string };

function runBinary(args: string[], home: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    const proc = spawn(process.execPath, [binary, ...args], {
      env: { ...process.env, LINKEDIN_TOOLKIT_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => (stdout += chunk));
    proc.stderr.on('data', (chunk) => (stderr += chunk));
    proc.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

describe('node dist/server.js --help', () => {
  it('explains what the binary is, prints the usage, and starts no bridge', async () => {
    requireBuild();
    const home = await isolatedHome();
    try {
      const { code, stdout, stderr } = await runBinary(['--help'], home);

      expect(code).toBe(0);

      // The explanation: what it is, how to wire it in, where the token is,
      // and what to run for the HTTP surface.
      expect(stdout).toContain('stdio MCP server');
      expect(stdout).toContain('Chrome extension');
      expect(stdout).toContain('"command": "npx"');
      expect(stdout).toContain('"linkedin-toolkit-mcp"');
      expect(stdout).toContain('~/.linkedin-toolkit/config.json');
      expect(stdout).toContain('lit config get token --reveal');
      expect(stdout).toContain('lit serve --http');

      // …followed by the CLI usage itself.
      expect(stdout).toContain('Usage: lit');
      expect(stdout).toContain('Commands:');
      expect(stdout.indexOf('stdio MCP server')).toBeLessThan(stdout.indexOf('Usage: lit'));

      // Help is a question, not a launch: no bridge, no pairing token, no
      // process left running.
      expect(stderr).not.toContain('bridge listening');
      expect(stderr).not.toContain('pairing token');
      expect(stdout).not.toContain('bridge listening');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('node dist/server.js with no arguments', () => {
  it('speaks MCP over stdio and answers initialize', async () => {
    requireBuild();
    const home = await isolatedHome();
    let child: ChildProcess | null = null;
    try {
      child = spawn(process.execPath, [binary], {
        env: { ...process.env, LINKEDIN_TOOLKIT_HOME: home },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const proc = child;

      let stderr = '';
      proc.stderr?.on('data', (chunk) => (stderr += chunk));

      const response = await new Promise<any>((resolvePromise, rejectPromise) => {
        let buffer = '';
        const timer = setTimeout(
          () =>
            rejectPromise(
              new Error(`no initialize response\n--- stdout ---\n${buffer}\n--- stderr ---\n${stderr}`),
            ),
          20_000,
        );
        proc.stdout?.on('data', (chunk) => {
          buffer += chunk;
          for (let cut = buffer.indexOf('\n'); cut >= 0; cut = buffer.indexOf('\n')) {
            const line = buffer.slice(0, cut).trim();
            buffer = buffer.slice(cut + 1);
            if (!line) continue;
            let message: any;
            try {
              message = JSON.parse(line);
            } catch {
              continue; // not an MCP frame; keep reading
            }
            if (message?.id === 1) {
              clearTimeout(timer);
              resolvePromise(message);
              return;
            }
          }
        });
        proc.on('error', rejectPromise);
        proc.on('exit', (code, signal) =>
          rejectPromise(new Error(`server exited early (code=${code} signal=${signal})\n${stderr}`)),
        );

        proc.stdin?.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'server-binary-test', version: '0.0.0' },
            },
          })}\n`,
        );
      });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.error).toBeUndefined();
      expect(response.result.serverInfo.name).toBe(SERVER_NAME);
      expect(typeof response.result.protocolVersion).toBe('string');
      expect(response.result.capabilities).toBeDefined();

      // The bridge the extension pairs with is up, and it said so on stderr —
      // stdout carries MCP frames and nothing else.
      expect(stderr).toContain('bridge listening');
    } finally {
      if (child && child.exitCode === null) {
        const exited = new Promise<void>((r) => child!.once('exit', () => r()));
        child.kill();
        await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});
