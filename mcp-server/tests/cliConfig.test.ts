/** `lit config`, `lit token rotate`, and the LINKEDIN_TOOLKIT_* env overrides. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, configPath, type ServerConfig } from '../src/config.js';
import { run, maskToken, coerceSetting, CliError, SETTABLE_KEYS } from '../src/cli.js';
import { HttpServer } from '../src/http.js';
import { makeHarness, TEST_TOKEN, type Harness } from './helpers.js';

let home: string;
let previousHome: string | undefined;
let previousUrl: string | undefined;
let previousToken: string | undefined;
let out: string[];
let err: string[];

const io = {
  out: (text: string) => out.push(text),
  err: (text: string) => err.push(text),
};

const stdout = () => out.join('\n');
const stderr = () => err.join('\n');
const stored = (): ServerConfig => JSON.parse(readFileSync(configPath(), 'utf8'));

beforeEach(() => {
  out = [];
  err = [];
  previousHome = process.env.LINKEDIN_TOOLKIT_HOME;
  previousUrl = process.env.LINKEDIN_TOOLKIT_URL;
  previousToken = process.env.LINKEDIN_TOOLKIT_TOKEN;
  delete process.env.LINKEDIN_TOOLKIT_URL;
  delete process.env.LINKEDIN_TOOLKIT_TOKEN;
  home = mkdtempSync(join(tmpdir(), 'lit-cfg-'));
  process.env.LINKEDIN_TOOLKIT_HOME = home;
});

afterEach(() => {
  for (const [name, value] of [
    ['LINKEDIN_TOOLKIT_HOME', previousHome],
    ['LINKEDIN_TOOLKIT_URL', previousUrl],
    ['LINKEDIN_TOOLKIT_TOKEN', previousToken],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(home, { recursive: true, force: true });
});

describe('maskToken', () => {
  it('leaves only the last four characters visible', () => {
    expect(maskToken('0123456789abcdef0123456789abcdef')).toBe(
      `${'*'.repeat(28)}cdef`,
    );
    expect(maskToken('abcd')).toBe('****');
    expect(maskToken('')).toBe('');
  });
});

describe('coerceSetting', () => {
  it('accepts valid ports and timeouts', () => {
    expect(coerceSetting('httpPort', '9000')).toEqual({ key: 'httpPort', value: 9000 });
    expect(coerceSetting('bridgePort', '1')).toEqual({ key: 'bridgePort', value: 1 });
    expect(coerceSetting('researchTimeoutMs', '60000')).toEqual({
      key: 'researchTimeoutMs',
      value: 60000,
    });
  });

  it('rejects ports out of range and non-integers', () => {
    for (const bad of ['0', '65536', 'nine', '80.5', '-1']) {
      expect(() => coerceSetting('httpPort', bad)).toThrow(CliError);
    }
  });

  it('rejects a research timeout under a second', () => {
    expect(() => coerceSetting('researchTimeoutMs', '999')).toThrow(/at least 1000/);
  });

  it('accepts an http or https webhook and unsets on empty', () => {
    expect(coerceSetting('webhookUrl', 'https://example.test/hook').value).toBe(
      'https://example.test/hook',
    );
    expect(coerceSetting('webhookUrl', '').value).toBeUndefined();
    expect(coerceSetting('webhookUrl', 'none').value).toBeUndefined();
  });

  it('rejects a non-URL and a non-http scheme', () => {
    expect(() => coerceSetting('webhookUrl', 'not a url')).toThrow(/must be a URL/);
    expect(() => coerceSetting('webhookUrl', 'ftp://example.test')).toThrow(/http or https/);
  });

  it('rejects an empty dbPath and resolves a relative one', () => {
    expect(() => coerceSetting('dbPath', '   ')).toThrow(/cannot be empty/);
    expect(String(coerceSetting('dbPath', 'toolkit.db').value)).toContain('toolkit.db');
  });

  it('refuses the token and anything unknown, and says where those live', () => {
    expect(() => coerceSetting('token', 'abc')).toThrow(/lit token rotate/);
    expect(() => coerceSetting('autopilot', 'true')).toThrow(/not a settable key/);
    expect(() => coerceSetting('autopilot', 'true')).toThrow(/live in the extension/);
  });
});

describe('lit config get', () => {
  it('masks the token by default', async () => {
    const { config } = loadConfig();
    out = [];
    const code = await run(['config', 'get'], io);
    expect(code).toBe(0);
    expect(stdout()).not.toContain(config.token);
    expect(stdout()).toContain(config.token.slice(-4));
    expect(stdout()).toContain('lit config get token --reveal');
  });

  it('reveals the token only when asked', async () => {
    const { config } = loadConfig();
    out = [];
    await run(['config', 'get', 'token', '--reveal'], io);
    expect(stdout()).toBe(config.token);
  });

  it('masks the token even when read as a single key', async () => {
    const { config } = loadConfig();
    out = [];
    await run(['config', 'get', 'token'], io);
    expect(stdout()).not.toContain(config.token);
  });

  it('prints one key', async () => {
    loadConfig();
    out = [];
    await run(['config', 'get', 'httpPort'], io);
    expect(stdout()).toBe('47830');
  });

  it('prints JSON with --json, still masked', async () => {
    const { config } = loadConfig();
    out = [];
    await run(['config', 'get', '--json'], io);
    const data = JSON.parse(stdout());
    expect(data.token).toBe(maskToken(config.token));
    expect(data.httpPort).toBe(47830);
  });

  it('rejects an unknown key', async () => {
    const code = await run(['config', 'get', 'nope'], io);
    expect(code).toBe(1);
    expect(stderr()).toContain('is not a setting');
  });
});

describe('lit config set', () => {
  it('writes a port and tells the user to restart', async () => {
    loadConfig();
    out = [];
    await run(['config', 'set', 'httpPort', '9001'], io);
    expect(stdout()).toContain('httpPort = 9001');
    expect(stdout()).toContain('Restart the server');
    expect(stored().httpPort).toBe(9001);
  });

  it('sets and unsets webhookUrl', async () => {
    loadConfig();
    await run(['config', 'set', 'webhookUrl', 'https://example.test/hook'], io);
    expect(stored().webhookUrl).toBe('https://example.test/hook');

    await run(['config', 'set', 'webhookUrl', ''], io);
    expect(stored().webhookUrl).toBeUndefined();
  });

  it('sets researchTimeoutMs without a restart notice', async () => {
    loadConfig();
    out = [];
    await run(['config', 'set', 'researchTimeoutMs', '120000'], io);
    expect(stored().researchTimeoutMs).toBe(120000);
    expect(stdout()).not.toContain('Restart');
  });

  it('rejects a bad value and leaves the file untouched', async () => {
    const before = loadConfig().config;
    const code = await run(['config', 'set', 'httpPort', '70000'], io);
    expect(code).toBe(1);
    expect(stderr()).toContain('between 1 and 65535');
    expect(stored().httpPort).toBe(before.httpPort);
  });

  it('never changes the token', async () => {
    const before = loadConfig().config.token;
    await run(['config', 'set', 'httpPort', '9002'], io);
    expect(stored().token).toBe(before);
  });
});

describe('lit token rotate', () => {
  it('replaces the token and prints pairing instructions', async () => {
    const before = loadConfig().config.token;
    out = [];
    const code = await run(['token', 'rotate'], io);
    expect(code).toBe(0);

    const after = stored().token;
    expect(after).toMatch(/^[0-9a-f]{32}$/);
    expect(after).not.toBe(before);
    expect(stdout()).toContain('Pairing token rotated');
    expect(stdout()).toContain(after);
    expect(stdout()).toContain('Settings > Bridge');
    expect(stdout()).toContain('Re-pair the extension');
  });

  it('keeps every other setting', async () => {
    loadConfig();
    await run(['config', 'set', 'httpPort', '9003'], io);
    await run(['config', 'set', 'webhookUrl', 'https://example.test/hook'], io);
    await run(['token', 'rotate'], io);
    expect(stored().httpPort).toBe(9003);
    expect(stored().webhookUrl).toBe('https://example.test/hook');
  });

  it('rejects any other token action', async () => {
    const code = await run(['token', 'spin'], io);
    expect(code).toBe(1);
    expect(stderr()).toContain('The only action is: rotate');
  });
});

describe('LINKEDIN_TOOLKIT_URL and LINKEDIN_TOOLKIT_TOKEN', () => {
  let harness: Harness | null = null;
  let http: HttpServer | null = null;

  afterEach(async () => {
    await http?.stop();
    http = null;
    await harness?.stop();
    harness = null;
  });

  it('point the CLI at a server the config knows nothing about', async () => {
    harness = await makeHarness();
    http = new HttpServer({ toolkit: harness.toolkit, port: 0 });
    await http.start();

    // The local config has a different token and the default port, so only the
    // environment can make this work.
    saveConfig({
      token: '0'.repeat(32),
      bridgePort: 47829,
      httpPort: 47830,
      dbPath: join(home, 'toolkit.db'),
      researchTimeoutMs: 600_000,
    });
    process.env.LINKEDIN_TOOLKIT_URL = http.url;
    process.env.LINKEDIN_TOOLKIT_TOKEN = TEST_TOKEN;

    out = [];
    const code = await run(['status'], io);
    expect(code).toBe(0);
    expect(stdout()).toContain('Extension: connected');
  });

  it('tolerate a trailing slash on the url', async () => {
    harness = await makeHarness();
    http = new HttpServer({ toolkit: harness.toolkit, port: 0 });
    await http.start();
    saveConfig({
      token: '0'.repeat(32),
      bridgePort: 47829,
      httpPort: 47830,
      dbPath: join(home, 'toolkit.db'),
      researchTimeoutMs: 600_000,
    });
    process.env.LINKEDIN_TOOLKIT_URL = `${http.url}/`;
    process.env.LINKEDIN_TOOLKIT_TOKEN = TEST_TOKEN;

    out = [];
    expect(await run(['status'], io)).toBe(0);
    expect(stdout()).toContain('Extension: connected');
  });

  it('report a wrong token from the environment clearly', async () => {
    harness = await makeHarness();
    http = new HttpServer({ toolkit: harness.toolkit, port: 0 });
    await http.start();
    loadConfig();
    process.env.LINKEDIN_TOOLKIT_URL = http.url;
    process.env.LINKEDIN_TOOLKIT_TOKEN = 'd'.repeat(32);

    const code = await run(['status'], io);
    expect(code).toBe(1);
    expect(stderr()).toContain('rejected the pairing token');
  });

  it('fall back to the config when unset', async () => {
    loadConfig();
    const code = await run(['status'], io);
    expect(code).toBe(1);
    expect(stderr()).toContain('server is not running');
  });
});

describe('help', () => {
  it('documents config, token and their settable keys', async () => {
    await run(['--help'], io);
    expect(stdout()).toContain('config');
    expect(stdout()).toContain('token');

    out = [];
    await run(['config', 'set', '--help'], io);
    for (const key of SETTABLE_KEYS) expect(stdout()).toContain(key);
  });
});
