/**
 * Local configuration at `~/.linkedin-toolkit/config.json`.
 *
 * Nothing here ever leaves the machine. The pairing token is generated on
 * first run and is the shared secret for both the WebSocket bridge and the
 * HTTP surface.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type ServerConfig = {
  token: string;
  bridgePort: number;
  httpPort: number;
  webhookUrl?: string;
  dbPath: string;
  researchTimeoutMs: number;
};

export const DEFAULT_BRIDGE_PORT = 47829;
export const DEFAULT_HTTP_PORT = 47830;
export const DEFAULT_RESEARCH_TIMEOUT_MS = 600_000;

/** `~/.linkedin-toolkit`, or `$LINKEDIN_TOOLKIT_HOME` when set (tests use this). */
export function toolkitHome(): string {
  return process.env.LINKEDIN_TOOLKIT_HOME || join(homedir(), '.linkedin-toolkit');
}

export function configPath(): string {
  return join(toolkitHome(), 'config.json');
}

/**
 * Where a running `lit serve` records the ports it actually bound, so the rest
 * of the CLI can find it even when the ports were overridden on the command
 * line. Best effort: a stale file just means the next command reports that the
 * server is not running.
 */
export function runtimePath(): string {
  return join(toolkitHome(), 'server.json');
}

export type RuntimeInfo = {
  httpPort: number;
  bridgePort: number;
  pid: number;
  startedAt: number;
};

export function writeRuntime(info: RuntimeInfo): void {
  mkdirSync(toolkitHome(), { recursive: true });
  writeFileSync(runtimePath(), `${JSON.stringify(info, null, 2)}\n`, 'utf8');
}

export function readRuntime(): RuntimeInfo | null {
  try {
    const raw = JSON.parse(readFileSync(runtimePath(), 'utf8'));
    if (!Number.isInteger(raw?.httpPort)) return null;
    return raw as RuntimeInfo;
  } catch {
    return null;
  }
}

export function clearRuntime(): void {
  try {
    rmSync(runtimePath(), { force: true });
  } catch {
    /* nothing to clear */
  }
}

export function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function defaults(): ServerConfig {
  return {
    token: generateToken(),
    bridgePort: DEFAULT_BRIDGE_PORT,
    httpPort: DEFAULT_HTTP_PORT,
    dbPath: join(toolkitHome(), 'toolkit.db'),
    researchTimeoutMs: DEFAULT_RESEARCH_TIMEOUT_MS,
  };
}

function coerce(raw: any): ServerConfig {
  const base = defaults();
  const token =
    typeof raw?.token === 'string' && /^[0-9a-f]{32}$/i.test(raw.token) ? raw.token : base.token;
  const config: ServerConfig = {
    token,
    bridgePort: Number.isInteger(raw?.bridgePort) ? raw.bridgePort : base.bridgePort,
    httpPort: Number.isInteger(raw?.httpPort) ? raw.httpPort : base.httpPort,
    dbPath: typeof raw?.dbPath === 'string' && raw.dbPath ? raw.dbPath : base.dbPath,
    researchTimeoutMs: Number.isInteger(raw?.researchTimeoutMs)
      ? raw.researchTimeoutMs
      : base.researchTimeoutMs,
  };
  if (typeof raw?.webhookUrl === 'string' && raw.webhookUrl) config.webhookUrl = raw.webhookUrl;
  return config;
}

/**
 * Read the config, creating it (and the token) on first run.
 * `createdToken` is true only when this call generated the token.
 */
export function loadConfig(): { config: ServerConfig; path: string; createdToken: boolean } {
  const path = configPath();
  if (!existsSync(path)) {
    const config = defaults();
    saveConfig(config);
    return { config, path, createdToken: true };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    raw = {};
  }
  const hadToken = typeof (raw as any)?.token === 'string' && /^[0-9a-f]{32}$/i.test((raw as any).token);
  const config = coerce(raw);
  if (!hadToken) saveConfig(config);
  return { config, path, createdToken: !hadToken };
}

export function saveConfig(config: ServerConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** Apply CLI overrides on top of the stored config without persisting them. */
export function withOverrides(
  config: ServerConfig,
  overrides: Partial<ServerConfig> = {},
): ServerConfig {
  const merged = { ...config };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) (merged as any)[key] = value;
  }
  return merged;
}

/** The block printed by `lit serve` so the user can pair the extension. */
export function pairingInstructions(config: ServerConfig, options: { http?: boolean } = {}): string {
  const lines = [
    'LinkedIn Toolkit server',
    '',
    `  bridge          ws://127.0.0.1:${config.bridgePort}`,
    options.http ? `  http            http://127.0.0.1:${config.httpPort}` : '  mcp             stdio',
    `  database        ${config.dbPath}`,
    `  config          ${configPath()}`,
    '',
    `  pairing token   ${config.token}`,
    '',
    'Pair the extension:',
    '  1. Open the LinkedIn Toolkit popup in Chrome.',
    '  2. Settings > Bridge.',
    '  3. Paste the pairing token above and enable the bridge.',
    '',
    'The token is stored in the config file; it never leaves this machine.',
  ];
  return lines.join('\n');
}
