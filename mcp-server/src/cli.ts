#!/usr/bin/env node
/**
 * `lit` — the command line for the LinkedIn Toolkit.
 *
 * `lit serve` runs the server (bridge plus MCP over stdio); `lit serve --http`
 * adds the HTTP surface. Every other command talks to that running server over
 * HTTP, so the CLI and an agent see exactly the same data through exactly the
 * same code path.
 */
import { Command, CommanderError } from 'commander';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  clearRuntime,
  generateToken,
  loadConfig,
  pairingInstructions,
  readRuntime,
  saveConfig,
  withOverrides,
  writeRuntime,
  type ServerConfig,
} from './config.js';
import { ORIGIN_HEADER } from './contract.js';
import { TABLES } from './db.js';
import { createDemoHandlers, FAKE_BANNER } from './fake-data.js';
import { FakeExtensionClient } from './fake-extension.js';
import { HttpServer } from './http.js';
import { Toolkit } from './toolkit.js';
import { createMcpServer, SERVER_VERSION } from './tools.js';

export const NOT_RUNNING =
  'linkedin-toolkit server is not running. Start it with: lit serve --http';

export type Io = {
  out: (text: string) => void;
  err: (text: string) => void;
};

const defaultIo: Io = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

/** Thrown to end a command with a message and a non-zero exit code. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

export function publicIdFrom(input: string): string {
  const match = /linkedin\.com\/in\/([^/?#]+)/i.exec(input);
  if (match) return decodeURIComponent(match[1]);
  return input.replace(/^\/+|\/+$/g, '');
}

export function universalNameFrom(input: string): string {
  const match = /linkedin\.com\/company\/([^/?#]+)/i.exec(input);
  if (match) return decodeURIComponent(match[1]);
  return input.replace(/^\/+|\/+$/g, '');
}

/** `24h`, `7d`, `30m`, or an epoch-milliseconds number. */
export function parseSince(input: string | undefined, now = Date.now()): number | undefined {
  if (!input) return undefined;
  const relative = /^(\d+)\s*(m|h|d)$/i.exec(input.trim());
  if (relative) {
    const value = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return now - value * ms;
  }
  const numeric = Number(input);
  if (Number.isFinite(numeric)) return numeric;
  throw new CliError(`Cannot read "${input}" as a time window. Use 30m, 24h, 7d or a timestamp.`);
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const keys = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [keys.join(','), ...rows.map((row) => keys.map((key) => cell(row[key])).join(','))].join('\n') + '\n';
}

/** A small RFC-4180-ish reader: quoted fields, doubled quotes, CRLF. */
export function fromCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (!header) return [];
  const keys = header.map((key) => key.trim());
  return body.map((values) =>
    Object.fromEntries(keys.map((key, index) => [key, (values[index] ?? '').trim()])),
  );
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'row'
  );
}

/** Fixed-width table for human output. */
export function table(rows: Record<string, unknown>[], columns: string[]): string {
  if (rows.length === 0) return '(nothing)';
  const text = rows.map((row) =>
    columns.map((column) => {
      const value = row[column];
      return value === null || value === undefined ? '' : String(value);
    }),
  );
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...text.map((row) => row[index].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd();
  return [line(columns), line(widths.map((width) => '-'.repeat(width))), ...text.map(line)].join('\n');
}

/* ------------------------------------------------------------------ *
 * HTTP client for the running server
 * ------------------------------------------------------------------ */

/** Settable keys of the local server config. `token` is deliberately absent. */
export const SETTABLE_KEYS = [
  'bridgePort',
  'httpPort',
  'webhookUrl',
  'dbPath',
  'researchTimeoutMs',
] as const;

export type SettableKey = (typeof SETTABLE_KEYS)[number];

/** Show only the last four characters, so a shoulder or a screen share leaks nothing. */
export function maskToken(token: string): string {
  if (!token) return '';
  return token.length <= 4 ? '*'.repeat(token.length) : `${'*'.repeat(token.length - 4)}${token.slice(-4)}`;
}

/** Parse and validate one `lit config set` value. Throws CliError on bad input. */
export function coerceSetting(key: string, raw: string): { key: SettableKey; value: unknown } {
  if (!(SETTABLE_KEYS as readonly string[]).includes(key)) {
    throw new CliError(
      `"${key}" is not a settable key. Choose one of: ${SETTABLE_KEYS.join(', ')}.\n` +
        'The pairing token is rotated with `lit token rotate`; LinkedIn behaviour settings ' +
        '(delays, caps, autopilot) live in the extension, not here.',
    );
  }
  const settable = key as SettableKey;

  if (settable === 'bridgePort' || settable === 'httpPort') {
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new CliError(`${settable} must be a whole number between 1 and 65535, not "${raw}".`);
    }
    return { key: settable, value: port };
  }

  if (settable === 'researchTimeoutMs') {
    const ms = Number(raw);
    if (!Number.isInteger(ms) || ms < 1000) {
      throw new CliError(`researchTimeoutMs must be a whole number of at least 1000, not "${raw}".`);
    }
    return { key: settable, value: ms };
  }

  if (settable === 'webhookUrl') {
    if (raw === '' || raw === 'none') return { key: settable, value: undefined };
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new CliError(`webhookUrl must be a URL, not "${raw}". Pass "" to unset it.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new CliError(`webhookUrl must be http or https, not "${url.protocol}".`);
    }
    return { key: settable, value: url.toString() };
  }

  if (raw.trim() === '') throw new CliError('dbPath cannot be empty.');
  return { key: settable, value: resolve(raw) };
}

export class ServerClient {
  constructor(
    readonly baseUrl: string,
    readonly token: string,
  ) {}

  /**
   * Where to find the server, most specific first:
   *   1. `LINKEDIN_TOOLKIT_URL` / `LINKEDIN_TOOLKIT_TOKEN` — the same names the
   *      docs and the Node and Python clients use, so one export points them
   *      all at the same place;
   *   2. the port a running `lit serve` actually bound, so
   *      `lit serve --http --port 9000` does not strand every other command;
   *   3. the configured default.
   */
  static fromConfig(config: ServerConfig): ServerClient {
    const port = readRuntime()?.httpPort ?? config.httpPort;
    const baseUrl = (process.env.LINKEDIN_TOOLKIT_URL || `http://127.0.0.1:${port}`).replace(
      /\/+$/,
      '',
    );
    return new ServerClient(baseUrl, process.env.LINKEDIN_TOOLKIT_TOKEN || config.token);
  }

  private async post(path: string, body: unknown): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
          // Marks these calls as human-originated rather than agent-originated.
          [ORIGIN_HEADER]: 'cli',
        },
        body: JSON.stringify(body ?? {}),
      });
    } catch {
      throw new CliError(NOT_RUNNING);
    }
    if (response.status === 401) {
      throw new CliError(
        'The server rejected the pairing token. Check ~/.linkedin-toolkit/config.json.',
      );
    }
    const envelope = (await response.json().catch(() => null)) as any;
    if (!envelope) throw new CliError(`The server returned ${response.status} with no body.`);
    if (envelope.ok === true) return envelope.data;
    const error = envelope.error ?? { code: 'INTERNAL', message: 'Unknown error.' };
    const parts = [`${error.code}: ${error.message}`];
    if (error.howToFix) parts.push(`  ${error.howToFix}`);
    if (error.retryAfter) parts.push(`  retry after ${error.retryAfter}s`);
    throw new CliError(parts.join('\n'));
  }

  action(action: string, params: unknown = {}): Promise<any> {
    return this.post(`/actions/${action}`, params);
  }

  tool(tool: string, args: unknown = {}): Promise<any> {
    return this.post(`/tools/${tool}`, args);
  }

  async health(): Promise<{ ok: boolean; extensionConnected: boolean; version: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return (await response.json()) as any;
    } catch {
      throw new CliError(NOT_RUNNING);
    }
  }
}

/* ------------------------------------------------------------------ *
 * serve
 * ------------------------------------------------------------------ */

export type ServeHandles = {
  toolkit: Toolkit;
  http?: HttpServer;
  fake?: FakeExtensionClient;
  stop: () => Promise<void>;
};

export async function serve(
  options: { http?: boolean; port?: number; bridgePort?: number; fake?: boolean },
  io: Io,
): Promise<ServeHandles> {
  const { config } = loadConfig();
  const merged = withOverrides(config, {
    httpPort: options.port,
    bridgePort: options.bridgePort,
  });
  const toolkit = new Toolkit({ config: merged });
  await toolkit.start();

  // In stdio mode stdout carries MCP frames, so the banner goes to stderr.
  const say = options.http ? io.out : io.err;
  if (options.fake) {
    const rule = '='.repeat(FAKE_BANNER.length);
    say(`${rule}\n${FAKE_BANNER}\n${rule}\n`);
  }
  say(pairingInstructions(merged, { http: options.http }));

  // The demo extension attaches over the real bridge, so fake mode exercises
  // exactly the same path a real extension would.
  let fake: FakeExtensionClient | undefined;
  if (options.fake) {
    fake = new FakeExtensionClient({ port: toolkit.bridge.port, token: merged.token });
    fake.setHandlers(createDemoHandlers((event, payload) => fake!.emit(event, payload)));
    await fake.connect();
    say('\nDemo extension connected. No pairing needed in fake mode.');
  }

  let http: HttpServer | undefined;
  if (options.http) {
    http = new HttpServer({ toolkit, port: merged.httpPort });
    await http.start();
    writeRuntime({
      httpPort: http.port,
      bridgePort: toolkit.bridge.port,
      pid: process.pid,
      startedAt: Date.now(),
    });
    io.out(`\nListening on ${http.url}. Ctrl-C to stop.`);
  } else {
    const server = createMcpServer(toolkit);
    await server.connect(new StdioServerTransport());
  }

  return {
    toolkit,
    http,
    fake,
    stop: async () => {
      if (http) clearRuntime();
      await fake?.close();
      await http?.stop();
      await toolkit.stop();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

function client(): ServerClient {
  return ServerClient.fromConfig(loadConfig().config);
}

function print(io: Io, json: boolean | undefined, data: unknown, human: () => string): void {
  if (json) io.out(JSON.stringify(data, null, 2));
  else io.out(human());
}

const PROFILE_COLUMNS = ['publicId', 'fullName', 'headline', 'company', 'location'];

async function saveToList(
  api: ServerClient,
  listName: string,
  profiles: any[],
  io: Io,
): Promise<void> {
  const { lists } = await api.action('list.getAll', {});
  const existing = (lists ?? []).find((list: any) => list.name === listName);
  const list = existing ?? (await api.action('list.create', { name: listName }));
  const result = await api.action('list.add', { listId: list.listId, profiles });
  io.out(`Saved ${result.added} to list "${listName}" (${result.duplicates} already there).`);
}

export function buildProgram(io: Io = defaultIo): Command {
  const program = new Command();

  program
    .name('lit')
    .description(
      'LinkedIn Toolkit: drive your own logged-in Chrome through the toolkit extension.\n' +
        'Start the server with `lit serve --http`, then every other command talks to it.',
    )
    .version(SERVER_VERSION)
    .configureOutput({
      writeOut: (text) => io.out(text.replace(/\n$/, '')),
      writeErr: (text) => io.err(text.replace(/\n$/, '')),
    });

  program
    .command('serve')
    .description('Run the bridge and the MCP server. Add --http for the HTTP API.')
    .option('--http', 'also serve the HTTP action API and MCP over Streamable HTTP')
    .option('--port <port>', 'HTTP port (default 47830)', (v) => Number(v))
    .option('--bridge-port <port>', 'WebSocket bridge port (default 47829)', (v) => Number(v))
    .option(
      '--fake',
      'run against built-in demo data instead of Chrome: no extension, no LinkedIn account, no network calls',
    )
    .action(async (options) => {
      const handles = await serve(
        {
          http: options.http,
          port: options.port,
          bridgePort: options.bridgePort,
          fake: options.fake,
        },
        io,
      );
      const shutdown = () => void handles.stop().finally(() => process.exit(0));
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      await new Promise(() => undefined); // run until interrupted
    });

  program
    .command('status')
    .description('Show the extension connection, quotas, queue and campaigns.')
    .option('--json', 'print raw JSON')
    .action(async (options) => {
      const api = client();
      const health = await api.health();
      if (!health.extensionConnected) {
        io.out('Server:    running');
        io.out('Extension: NOT CONNECTED');
        io.out('');
        io.out('Open the toolkit popup in Chrome, go to Settings > Bridge, paste the pairing');
        io.out('token from ~/.linkedin-toolkit/config.json and enable the bridge.');
        return;
      }
      const status = await api.action('status.get', {});
      print(io, options.json, status, () =>
        [
          `Server:    running (v${health.version})`,
          `Extension: connected (v${status.extensionVersion})`,
          `LinkedIn:  ${status.loggedIn ? 'logged in' : 'NOT logged in'}`,
          `Mode:      ${status.autopilot ? 'Autopilot' : 'Copilot (writes need approval)'}`,
          `Hours:     ${status.businessHours ? 'inside business hours' : 'outside business hours'}`,
          '',
          table(
            Object.entries(status.quotas ?? {}).map(([kind, quota]: [string, any]) => ({
              quota: kind,
              hourly: `${quota.hourlyUsed}/${quota.hourlyCap}`,
              daily: `${quota.dailyUsed}/${quota.dailyCap}`,
            })),
            ['quota', 'hourly', 'daily'],
          ),
          '',
          `Queue:     ${status.queue?.pending ?? 0} pending`,
          `Campaigns: ${status.campaigns?.active ?? 0} active, ${status.campaigns?.paused ?? 0} paused`,
        ].join('\n'),
      );
    });

  program
    .command('search')
    .argument('<keywords>', 'what to search for')
    .description('Search LinkedIn people.')
    .option('--source <source>', 'search | salesnav | recruiter', 'search')
    .option('--count <n>', 'how many results (max 100)', (v) => Number(v))
    .option('--csv <file>', 'write the results to a CSV file')
    .option('--list <name>', 'save the results to a list')
    .option('--json', 'print raw JSON')
    .action(async (keywords, options) => {
      const api = client();
      const data = await api.action('search.people', {
        keywords,
        source: options.source,
        ...(options.count ? { count: options.count } : {}),
      });
      const profiles = data.profiles ?? [];

      if (options.csv) {
        writeFileSync(resolve(options.csv), toCsv(profiles, PROFILE_COLUMNS), 'utf8');
        io.out(`Wrote ${profiles.length} profiles to ${options.csv}`);
      }
      if (options.list) await saveToList(api, options.list, profiles, io);
      if (!options.csv || options.json) {
        print(io, options.json, data, () => table(profiles, PROFILE_COLUMNS));
      }
    });

  program
    .command('profile')
    .argument('<url>', 'profile URL or publicId')
    .description('Fetch one profile.')
    .option('--full', 'capture the full page, experience and photo (costs one profile visit)')
    .option('--json', 'print raw JSON')
    .action(async (url, options) => {
      const data = await client().action('profile.get', {
        publicId: publicIdFrom(url),
        ...(options.full ? { full: true } : {}),
      });
      print(io, options.json, data, () =>
        [
          data.fullName,
          data.headline ?? '',
          [data.company, data.location].filter(Boolean).join(' — '),
          data.url,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    });

  program
    .command('engagers')
    .argument('<postUrl>', 'the post URL')
    .description('List people who liked or commented on a post.')
    .option('--kind <kind>', 'likes | comments | both', 'both')
    .option('--list <name>', 'save the engagers to a list')
    .option('--json', 'print raw JSON')
    .action(async (postUrl, options) => {
      const api = client();
      const data = await api.action('post.engagers', { postUrl, kind: options.kind });
      const engagers = data.engagers ?? [];
      if (options.list) await saveToList(api, options.list, engagers, io);
      print(io, options.json, data, () =>
        table(engagers, [...PROFILE_COLUMNS, 'reaction']),
      );
    });

  program
    .command('company')
    .argument('<url>', 'company URL or universalName')
    .description('Fetch a company, and optionally its employees.')
    .option('--employees', 'also list employees')
    .option('--json', 'print raw JSON')
    .action(async (url, options) => {
      const api = client();
      const universalName = universalNameFrom(url);
      const company = await api.action('company.get', { universalName });
      const employees = options.employees
        ? (await api.action('company.employees', { universalName })).profiles ?? []
        : [];
      print(io, options.json, options.employees ? { company, employees } : company, () =>
        [
          `${company.name} (${company.universalName})`,
          [company.industry, company.size, company.hq].filter(Boolean).join(' — '),
          company.url,
          ...(options.employees ? ['', table(employees, PROFILE_COLUMNS)] : []),
        ]
          .filter(Boolean)
          .join('\n'),
      );
    });

  program
    .command('invite')
    .argument('<url>', 'profile URL or publicId')
    .description('Send a connection invite (queued for approval in Copilot mode).')
    .option('--note <note>', 'a note, under 300 characters')
    .option('--dry-run', 'show what would be sent without sending it')
    .action(async (url, options) => {
      const data = await client().action('outreach.invite', {
        publicId: publicIdFrom(url),
        ...(options.note ? { note: options.note } : {}),
        ...(options.dryRun ? { dry_run: true } : {}),
      });
      io.out(
        data.status === 'queued'
          ? `Queued for approval (${data.queueId}). Approve it with: lit queue approve ${data.queueId}`
          : `Invite ${data.status}.`,
      );
    });

  program
    .command('message')
    .argument('<url>', 'profile URL or publicId')
    .requiredOption('--body <body>', 'the message body')
    .description('Send a message to a first-degree connection.')
    .option('--dry-run', 'show what would be sent without sending it')
    .action(async (url, options) => {
      const data = await client().action('outreach.message', {
        publicId: publicIdFrom(url),
        body: options.body,
        ...(options.dryRun ? { dry_run: true } : {}),
      });
      io.out(
        data.status === 'queued'
          ? `Queued for approval (${data.queueId}). Approve it with: lit queue approve ${data.queueId}`
          : `Message ${data.status}.`,
      );
    });

  program
    .command('inbox')
    .description('List inbox threads.')
    .option('--since <window>', 'e.g. 24h, 7d, or a timestamp')
    .option('--sentiment', 'show the sentiment column')
    .option('--json', 'print raw JSON')
    .action(async (options) => {
      const since = parseSince(options.since);
      const data = await client().action('inbox.threads', since ? { since } : {});
      const threads = (data.threads ?? []).map((thread: any) => ({
        threadId: thread.threadId,
        who: (thread.participants ?? []).map((p: any) => p.fullName).join(', '),
        unread: thread.unread ? 'yes' : '',
        sentiment: thread.sentiment ?? '',
        snippet: thread.snippet,
      }));
      const columns = ['threadId', 'who', 'unread', ...(options.sentiment ? ['sentiment'] : []), 'snippet'];
      print(io, options.json, data, () => table(threads, columns));
    });

  program
    .command('queue')
    .argument('[action]', 'approve | reject | list', 'list')
    .argument('[ids...]', 'queue item ids')
    .description('Show the approval queue, or approve or reject items.')
    .option('--json', 'print raw JSON')
    .action(async (action, ids: string[], options) => {
      const api = client();
      if (action === 'approve' || action === 'reject') {
        if (ids.length === 0) throw new CliError(`Give at least one id: lit queue ${action} <id>`);
        const data = await api.action(`queue.${action}`, { ids });
        io.out(`${action === 'approve' ? 'Approved' : 'Rejected'} ${data.approved ?? data.rejected}.`);
        return;
      }
      if (action !== 'list') throw new CliError(`Unknown queue action "${action}".`);
      const data = await api.action('queue.list', { status: 'pending' });
      const items = (data.items ?? []).map((item: any) => ({
        id: item.id,
        action: item.action,
        who: item.profile?.fullName ?? item.params?.publicId ?? '',
        origin: item.origin,
        preview: String(item.params?.note ?? item.params?.body ?? '').slice(0, 60),
      }));
      print(io, options.json, data, () =>
        table(items, ['id', 'action', 'who', 'origin', 'preview']),
      );
    });

  const campaign = program.command('campaign').description('Create and control campaigns.');

  campaign
    .command('create')
    .requiredOption('--from <file>', 'a JSON file with { name, steps } or a bare steps array')
    .option('--list <name>', 'enroll everyone in this list')
    .option('--json', 'print raw JSON')
    .description('Create a campaign from a JSON sequence file.')
    .action(async (options) => {
      const api = client();
      const parsed = JSON.parse(readFileSync(resolve(options.from), 'utf8'));
      const steps = Array.isArray(parsed) ? parsed : parsed.steps;
      if (!Array.isArray(steps)) throw new CliError(`${options.from} has no steps array.`);
      const name = Array.isArray(parsed) ? `Campaign ${new Date().toISOString().slice(0, 10)}` : parsed.name;

      let listId: string | undefined;
      if (options.list) {
        const { lists } = await api.action('list.getAll', {});
        const found = (lists ?? []).find((list: any) => list.name === options.list);
        if (!found) throw new CliError(`No list named "${options.list}".`);
        listId = found.listId;
      }
      const data = await api.action('campaign.create', {
        name,
        steps,
        ...(listId ? { listId } : {}),
        ...(parsed.settings ? { settings: parsed.settings } : {}),
      });
      print(io, options.json, data, () =>
        `Created campaign "${data.name}" (${data.campaignId}) with ${steps.length} steps, status ${data.status}.`,
      );
    });

  campaign
    .command('list')
    .description('List every campaign.')
    .option('--json', 'print raw JSON')
    .action(async (options) => {
      const data = await client().action('campaign.getAll', {});
      const campaigns = (data.campaigns ?? []).map((c: any) => ({
        campaignId: c.campaignId,
        name: c.name,
        status: c.status,
        steps: (c.steps ?? []).length,
        enrolled: c.stats?.enrolled ?? '',
        sent: c.stats?.sent ?? '',
        replied: c.stats?.replied ?? '',
      }));
      print(io, options.json, data, () =>
        table(campaigns, ['campaignId', 'name', 'status', 'steps', 'enrolled', 'sent', 'replied']),
      );
    });

  for (const verb of ['pause', 'resume'] as const) {
    campaign
      .command(verb)
      .argument('<campaignId>')
      .description(`${verb[0].toUpperCase()}${verb.slice(1)} a campaign.`)
      .action(async (campaignId) => {
        const data = await client().action(`campaign.${verb}`, { campaignId });
        io.out(`Campaign "${data.name}" is now ${data.status}.`);
      });
  }

  program
    .command('sql')
    .argument('<query>', 'a single SELECT or WITH statement')
    .description('Query the local SQLite mirror (read-only, 1,000 rows).')
    .option('--csv <file>', 'write the rows to a CSV file')
    .option('--json', 'print raw JSON')
    .action(async (query, options) => {
      const data = await client().tool('linkedin_query_sql', { sql: query });
      if (options.csv) {
        writeFileSync(resolve(options.csv), toCsv(data.rows, data.columns), 'utf8');
        io.out(`Wrote ${data.rowCount} rows to ${options.csv}`);
        return;
      }
      print(io, options.json, data, () => {
        const rendered = table(data.rows, data.columns);
        return data.truncated ? `${rendered}\n\n(truncated at 1,000 rows)` : rendered;
      });
    });

  program
    .command('export')
    .requiredOption('--table <table>', `one of: ${TABLES.join(', ')}`)
    .requiredOption('--csv <file>', 'the file to write')
    .description('Export a table from the local mirror to CSV.')
    .action(async (options) => {
      if (!(TABLES as readonly string[]).includes(options.table)) {
        throw new CliError(`Unknown table "${options.table}". Choose one of: ${TABLES.join(', ')}`);
      }
      const data = await client().tool('linkedin_query_sql', {
        sql: `SELECT * FROM ${options.table}`,
      });
      writeFileSync(resolve(options.csv), toCsv(data.rows, data.columns), 'utf8');
      io.out(`Wrote ${data.rowCount} rows from ${options.table} to ${options.csv}`);
    });

  program
    .command('sync')
    .description('Pull everything changed in the extension into the local mirror.')
    .option('--since <window>', 'e.g. 24h, 7d, or a timestamp')
    .option('--json', 'print raw JSON')
    .action(async (options) => {
      const since = parseSince(options.since);
      const data = await client().tool('linkedin_sync', since === undefined ? {} : { since });
      print(io, options.json, data, () => {
        const changed = Object.entries(data.counts ?? {});
        if (changed.length === 0) return 'Nothing changed since the last sync.';
        return [
          'Synced:',
          ...changed.map(([table, count]) => `  ${table}: ${count}`),
          '',
          `Mirror now holds ${data.totals.profiles} profiles. Query it with: lit sql "SELECT ..."`,
        ].join('\n');
      });
    });

  const configCommand = program
    .command('config')
    .description('Read and change this server\'s local settings (~/.linkedin-toolkit/config.json).');

  configCommand
    .command('get')
    .argument('[key]', `one of: token, ${SETTABLE_KEYS.join(', ')}`)
    .description('Print the local server settings, or one of them. The token is masked.')
    .option('--reveal', 'print the pairing token in full instead of masking it')
    .option('--json', 'print raw JSON')
    .action((key, options) => {
      const { config } = loadConfig();
      const shown: Record<string, unknown> = {
        ...config,
        token: options.reveal ? config.token : maskToken(config.token),
      };
      if (config.webhookUrl === undefined) shown.webhookUrl = '';

      if (key) {
        if (!(key in shown)) {
          throw new CliError(
            `"${key}" is not a setting. Choose one of: token, ${SETTABLE_KEYS.join(', ')}.`,
          );
        }
        io.out(options.json ? JSON.stringify(shown[key]) : String(shown[key] ?? ''));
        return;
      }

      print(io, options.json, shown, () =>
        [
          table(
            Object.entries(shown).map(([name, value]) => ({
              setting: name,
              value: String(value ?? ''),
            })),
            ['setting', 'value'],
          ),
          '',
          options.reveal
            ? 'Pair the extension with the token above: popup > Settings > Bridge.'
            : 'The token is masked. Show it with: lit config get token --reveal',
        ].join('\n'),
      );
    });

  configCommand
    .command('set')
    .argument('<key>', SETTABLE_KEYS.join(' | '))
    .argument('<value>', 'the new value; pass "" to unset webhookUrl')
    .description('Change one local server setting.')
    .action((key, value) => {
      const { config } = loadConfig();
      const { key: settable, value: parsed } = coerceSetting(key, value);
      const next = { ...config };
      if (parsed === undefined) delete next[settable as 'webhookUrl'];
      else (next as any)[settable] = parsed;
      saveConfig(next);
      io.out(`${settable} = ${parsed === undefined ? '(unset)' : String(parsed)}`);
      if (settable === 'bridgePort' || settable === 'httpPort' || settable === 'dbPath') {
        io.out('Restart the server for this to take effect: lit serve --http');
      }
    });

  program
    .command('token')
    .argument('<action>', 'rotate')
    .description('Manage the pairing token.')
    .action((action) => {
      if (action !== 'rotate') {
        throw new CliError(`Unknown token action "${action}". The only action is: rotate`);
      }
      const { config } = loadConfig();
      const rotated = { ...config, token: generateToken() };
      saveConfig(rotated);
      io.out('Pairing token rotated. The old token no longer works.');
      io.out('');
      io.out(pairingInstructions(rotated, { http: true }));
      io.out('');
      io.out('Re-pair the extension with the new token, and restart a running server so it');
      io.out('starts accepting the new one: lit serve --http');
    });

  program
    .command('research')
    .argument('<input>', 'a CSV of rows with any of: name, linkedinUrl, email, domain, company')
    .description('Turn a CSV of rows into research packs.')
    .option('--out <dir>', 'where to write the packs', './packs')
    .option('--enrich', 'also run the configured enrichment provider')
    .option('--list <name>', 'save everyone resolved to this list')
    .option('--poll <ms>', 'how often to poll for progress', (v) => Number(v), 2000)
    .action(async (input, options) => {
      const api = client();
      const rows = fromCsv(readFileSync(resolve(input), 'utf8'));
      if (rows.length === 0) throw new CliError(`${input} has no rows.`);
      io.out(`Researching ${rows.length} rows...`);

      const started = await api.action('research.pack', {
        rows,
        ...(options.list ? { listName: options.list } : {}),
        ...(options.enrich ? { enrich: true } : {}),
      });
      const jobId = started.jobId;
      io.out(`Job ${jobId} started (${started.total} rows).`);

      let done = -1;
      let result: any;
      for (;;) {
        result = await api.action('research.get', { jobId });
        if (result.done !== done) {
          done = result.done;
          io.out(`  ${done}/${result.total} packs`);
        }
        if (result.status === 'completed' || result.status === 'failed') break;
        await new Promise((r) => setTimeout(r, options.poll));
      }
      if (result.status === 'failed') throw new CliError(`Job ${jobId} failed.`);

      const outDir = resolve(options.out);
      const packs: any[] = result.packs ?? [];
      const csvRows: Record<string, string>[] = [];
      for (const pack of packs) {
        const name =
          pack.resolved?.publicId ??
          pack.profile?.publicId ??
          pack.resolved?.universalName ??
          pack.row?.name ??
          'row';
        const dir = join(outDir, slugify(String(name)));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'pack.md'), pack.markdown ?? '', 'utf8');
        writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
        if (pack.csvRow) csvRows.push(pack.csvRow);
      }
      if (csvRows.length > 0) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, 'output.csv'), toCsv(csvRows), 'utf8');
      }
      io.out(`Wrote ${packs.length} packs to ${outDir}`);
      if (csvRows.length > 0) io.out(`Wrote ${join(outDir, 'output.csv')}`);
    });

  return program;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function run(argv: string[], io: Io = defaultIo): Promise<number> {
  const program = buildProgram(io);
  program.exitOverride();
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help and --version are not failures.
      return err.exitCode === 0 || err.code === 'commander.helpDisplayed' ? 0 : err.exitCode;
    }
    if (err instanceof CliError) {
      io.err(err.message);
      return err.exitCode;
    }
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const invokedDirectly = process.argv[1]?.endsWith('cli.js') ?? false;
if (invokedDirectly) {
  run(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
