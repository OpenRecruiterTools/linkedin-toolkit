/**
 * The config file holds the pairing token, so it is written owner-only.
 *
 * `config.test.ts` asserts the resulting mode with `statSync`, but that check
 * can only run on POSIX — on Windows the mode bits are advisory and NTFS ACLs
 * govern, so it is skipped, which means on a Windows dev machine nothing would
 * catch the options being dropped. These tests watch the `node:fs` calls
 * themselves and therefore run everywhere.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const observed = vi.hoisted(() => ({
  writes: [] as { path: string; options: unknown }[],
  dirs: [] as { path: string; options: unknown }[],
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: actual,
    writeFileSync: (path: any, data: any, options: any) => {
      observed.writes.push({ path: String(path), options });
      return actual.writeFileSync(path, data, options);
    },
    mkdirSync: (path: any, options: any) => {
      observed.dirs.push({ path: String(path), options });
      return actual.mkdirSync(path, options);
    },
  };
});

const { loadConfig, saveConfig, configPath, runtimePath, writeRuntime } = await import(
  '../src/config.js'
);

let home: string;
let previous: string | undefined;

beforeEach(() => {
  observed.writes.length = 0;
  observed.dirs.length = 0;
  previous = process.env.LINKEDIN_TOOLKIT_HOME;
  home = mkdtempSync(join(tmpdir(), 'lit-perm-'));
  process.env.LINKEDIN_TOOLKIT_HOME = home;
});

afterEach(() => {
  if (previous === undefined) delete process.env.LINKEDIN_TOOLKIT_HOME;
  else process.env.LINKEDIN_TOOLKIT_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

const writeFor = (path: string) => observed.writes.find((write) => write.path === path);
const dirFor = (path: string) => observed.dirs.find((dir) => dir.path === path);

describe('config.json', () => {
  it('is written 0600 into a 0700 directory on first run', () => {
    loadConfig();
    expect(writeFor(configPath())?.options).toMatchObject({ encoding: 'utf8', mode: 0o600 });
    expect(dirFor(home)?.options).toMatchObject({ recursive: true, mode: 0o700 });
  });

  it('keeps the mode on every later save', () => {
    const { config } = loadConfig();
    observed.writes.length = 0;
    saveConfig({ ...config, httpPort: 5555 });
    expect(writeFor(configPath())?.options).toMatchObject({ mode: 0o600 });
  });

  it('is still readable after being written with a mode', () => {
    const first = loadConfig().config;
    expect(loadConfig().config.token).toBe(first.token);
  });
});

describe('server.json', () => {
  it('is written 0600 into a 0700 directory', () => {
    writeRuntime({ httpPort: 1, bridgePort: 2, pid: 3, startedAt: 4 });
    expect(writeFor(runtimePath())?.options).toMatchObject({ encoding: 'utf8', mode: 0o600 });
    expect(dirFor(home)?.options).toMatchObject({ recursive: true, mode: 0o700 });
  });
});
