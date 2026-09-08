import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  saveConfig,
  configPath,
  clearRuntime,
  pairingInstructions,
  readRuntime,
  runtimePath,
  writeRuntime,
  withOverrides,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_HTTP_PORT,
  DEFAULT_RESEARCH_TIMEOUT_MS,
} from '../src/config.js';

let home: string;
let previous: string | undefined;

beforeEach(() => {
  previous = process.env.LINKEDIN_TOOLKIT_HOME;
  home = mkdtempSync(join(tmpdir(), 'lit-home-'));
  process.env.LINKEDIN_TOOLKIT_HOME = home;
});

afterEach(() => {
  if (previous === undefined) delete process.env.LINKEDIN_TOOLKIT_HOME;
  else process.env.LINKEDIN_TOOLKIT_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('creates the file with a 32 hex char token on first run', () => {
    const { config, path, createdToken } = loadConfig();
    expect(createdToken).toBe(true);
    expect(config.token).toMatch(/^[0-9a-f]{32}$/);
    expect(config.bridgePort).toBe(DEFAULT_BRIDGE_PORT);
    expect(config.httpPort).toBe(DEFAULT_HTTP_PORT);
    expect(config.researchTimeoutMs).toBe(DEFAULT_RESEARCH_TIMEOUT_MS);
    expect(config.dbPath).toBe(join(home, 'toolkit.db'));
    expect(path).toBe(configPath());
    expect(JSON.parse(readFileSync(path, 'utf8')).token).toBe(config.token);
  });

  it('keeps the same token on the next run', () => {
    const first = loadConfig();
    const second = loadConfig();
    expect(second.createdToken).toBe(false);
    expect(second.config.token).toBe(first.config.token);
  });

  it('preserves ports and webhookUrl written by hand', () => {
    const first = loadConfig().config;
    saveConfig({ ...first, httpPort: 5555, webhookUrl: 'http://127.0.0.1:9/hook' });
    const { config } = loadConfig();
    expect(config.httpPort).toBe(5555);
    expect(config.webhookUrl).toBe('http://127.0.0.1:9/hook');
  });

  it('replaces a corrupt file and a malformed token', () => {
    writeFileSync(configPath(), 'not json at all', 'utf8');
    const { config, createdToken } = loadConfig();
    expect(createdToken).toBe(true);
    expect(config.token).toMatch(/^[0-9a-f]{32}$/);

    writeFileSync(configPath(), JSON.stringify({ token: 'short' }), 'utf8');
    const again = loadConfig();
    expect(again.createdToken).toBe(true);
    expect(again.config.token).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('runtime file', () => {
  it('records and clears the ports a running server bound', () => {
    expect(readRuntime()).toBeNull();
    writeRuntime({ httpPort: 9001, bridgePort: 9002, pid: 123, startedAt: 5 });
    expect(readRuntime()).toEqual({ httpPort: 9001, bridgePort: 9002, pid: 123, startedAt: 5 });
    clearRuntime();
    expect(readRuntime()).toBeNull();
  });

  it('treats a corrupt runtime file as no server', () => {
    writeFileSync(runtimePath(), 'nonsense', 'utf8');
    expect(readRuntime()).toBeNull();
  });
});

describe('withOverrides', () => {
  it('applies only defined overrides', () => {
    const { config } = loadConfig();
    const merged = withOverrides(config, { httpPort: 1234, bridgePort: undefined });
    expect(merged.httpPort).toBe(1234);
    expect(merged.bridgePort).toBe(config.bridgePort);
  });
});

describe('pairingInstructions', () => {
  it('prints the token and the three pairing steps', () => {
    const { config } = loadConfig();
    const text = pairingInstructions(config, { http: true });
    expect(text).toContain(config.token);
    expect(text).toContain(`ws://127.0.0.1:${config.bridgePort}`);
    expect(text).toContain(`http://127.0.0.1:${config.httpPort}`);
    expect(text).toContain('Settings > Bridge');
    expect(text).toContain('never leaves this machine');
  });

  it('says stdio when the HTTP server is not running', () => {
    const { config } = loadConfig();
    expect(pairingInstructions(config)).toContain('stdio');
  });
});
