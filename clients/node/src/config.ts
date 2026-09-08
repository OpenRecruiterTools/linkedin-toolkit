/**
 * Where the client gets its URL and token from, in this order:
 *
 *   1. what the caller passed to the constructor
 *   2. `LINKEDIN_TOOLKIT_URL` / `LINKEDIN_TOOLKIT_TOKEN`
 *   3. `~/.linkedin-toolkit/server.json` — the port a running `lit serve` bound,
 *      which is the only source that knows about `lit serve --http --port 9000`
 *   4. `~/.linkedin-toolkit/config.json` — the token, and the configured port
 *   5. `http://127.0.0.1:47830`
 *
 * `LINKEDIN_TOOLKIT_HOME` moves the directory, exactly as it does for the server.
 * Nothing here throws: a missing or unreadable file simply does not contribute.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:47830';

export type ResolvedConfig = {
  baseUrl: string;
  token?: string;
  /** Which of the five sources supplied the URL, for diagnostics. */
  baseUrlSource: 'option' | 'env' | 'server.json' | 'config.json' | 'default';
  tokenSource: 'option' | 'env' | 'config.json' | 'none';
};

export function toolkitHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.LINKEDIN_TOOLKIT_HOME || join(homedir(), '.linkedin-toolkit');
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function port(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536
    ? value
    : null;
}

/** Trailing slashes are tolerated, the same way `lit` tolerates them. */
export function normaliseBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function resolveConfig(
  options: { baseUrl?: string; token?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const home = toolkitHome(env);
  const runtime = readJson(join(home, 'server.json'));
  const config = readJson(join(home, 'config.json'));

  let baseUrl: string;
  let baseUrlSource: ResolvedConfig['baseUrlSource'];
  const runtimePort = runtime ? port(runtime.httpPort) : null;
  const configPort = config ? port(config.httpPort) : null;

  if (options.baseUrl) {
    baseUrl = options.baseUrl;
    baseUrlSource = 'option';
  } else if (env.LINKEDIN_TOOLKIT_URL) {
    baseUrl = env.LINKEDIN_TOOLKIT_URL;
    baseUrlSource = 'env';
  } else if (runtimePort !== null) {
    baseUrl = `http://127.0.0.1:${runtimePort}`;
    baseUrlSource = 'server.json';
  } else if (configPort !== null) {
    baseUrl = `http://127.0.0.1:${configPort}`;
    baseUrlSource = 'config.json';
  } else {
    baseUrl = DEFAULT_BASE_URL;
    baseUrlSource = 'default';
  }

  let token: string | undefined;
  let tokenSource: ResolvedConfig['tokenSource'];
  if (options.token) {
    token = options.token;
    tokenSource = 'option';
  } else if (env.LINKEDIN_TOOLKIT_TOKEN) {
    token = env.LINKEDIN_TOOLKIT_TOKEN;
    tokenSource = 'env';
  } else if (config && typeof config.token === 'string' && config.token) {
    token = config.token;
    tokenSource = 'config.json';
  } else {
    tokenSource = 'none';
  }

  return { baseUrl: normaliseBaseUrl(baseUrl), token, baseUrlSource, tokenSource };
}
