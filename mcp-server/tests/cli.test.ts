import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpServer } from '../src/http.js';
import { saveConfig, type ServerConfig } from '../src/config.js';
import {
  run,
  toCsv,
  fromCsv,
  parseSince,
  publicIdFrom,
  universalNameFrom,
  slugify,
  table,
  NOT_RUNNING,
  CliError,
} from '../src/cli.js';
import { makeHarness, TEST_TOKEN, type Harness } from './helpers.js';
import { defaultHandlers, pack } from './fixtures.js';
import type { Handlers } from './fakeExtension.js';

let harness: Harness | null = null;
let http: HttpServer | null = null;
let home: string;
let previousHome: string | undefined;
let out: string[];
let err: string[];

const io = {
  out: (text: string) => out.push(text),
  err: (text: string) => err.push(text),
};

const stdout = () => out.join('\n');
const stderr = () => err.join('\n');

/** Start a server on an ephemeral port and point the CLI's config at it. */
async function startServer(handlers?: Handlers): Promise<void> {
  harness = await makeHarness({ handlers });
  http = new HttpServer({ toolkit: harness.toolkit, port: 0 });
  await http.start();
  const config: ServerConfig = {
    token: TEST_TOKEN,
    bridgePort: harness.toolkit.bridge.port,
    httpPort: http.port,
    dbPath: harness.config.dbPath,
    researchTimeoutMs: 2000,
  };
  saveConfig(config);
}

beforeEach(() => {
  out = [];
  err = [];
  previousHome = process.env.LINKEDIN_TOOLKIT_HOME;
  home = mkdtempSync(join(tmpdir(), 'lit-cli-'));
  process.env.LINKEDIN_TOOLKIT_HOME = home;
});

afterEach(async () => {
  await http?.stop();
  http = null;
  await harness?.stop();
  harness = null;
  if (previousHome === undefined) delete process.env.LINKEDIN_TOOLKIT_HOME;
  else process.env.LINKEDIN_TOOLKIT_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */

describe('helpers', () => {
  it('reads a publicId out of a profile URL or takes it bare', () => {
    expect(publicIdFrom('https://www.linkedin.com/in/ada-lovelace/')).toBe('ada-lovelace');
    expect(publicIdFrom('https://linkedin.com/in/ada-lovelace?trk=x')).toBe('ada-lovelace');
    expect(publicIdFrom('ada-lovelace')).toBe('ada-lovelace');
  });

  it('reads a universalName out of a company URL', () => {
    expect(universalNameFrom('https://www.linkedin.com/company/difference-engine/')).toBe(
      'difference-engine',
    );
    expect(universalNameFrom('difference-engine')).toBe('difference-engine');
  });

  it('parses relative and absolute time windows', () => {
    const now = 1_000_000_000;
    expect(parseSince('24h', now)).toBe(now - 86_400_000);
    expect(parseSince('7d', now)).toBe(now - 7 * 86_400_000);
    expect(parseSince('30m', now)).toBe(now - 1_800_000);
    expect(parseSince('12345', now)).toBe(12345);
    expect(parseSince(undefined, now)).toBeUndefined();
    expect(() => parseSince('soon', now)).toThrow(CliError);
  });

  it('round-trips CSV including quotes, commas and newlines', () => {
    const rows = [
      { name: 'Ada, Countess', note: 'said "hello"' },
      { name: 'Grace', note: 'line one\nline two' },
    ];
    const parsed = fromCsv(toCsv(rows, ['name', 'note']));
    expect(parsed).toEqual([
      { name: 'Ada, Countess', note: 'said "hello"' },
      { name: 'Grace', note: 'line one\nline two' },
    ]);
  });

  it('reads a CSV with CRLF and blank lines', () => {
    expect(fromCsv('name,company\r\nAda,DE Ltd\r\n\r\n')).toEqual([
      { name: 'Ada', company: 'DE Ltd' },
    ]);
  });

  it('slugifies for directory names', () => {
    expect(slugify('Ada Lovelace')).toBe('ada-lovelace');
    expect(slugify('!!!')).toBe('row');
  });

  it('renders an aligned table and an empty one', () => {
    expect(table([{ a: 1, b: 'x' }], ['a', 'b'])).toContain('a  b');
    expect(table([], ['a'])).toBe('(nothing)');
  });
});

describe('--help', () => {
  it('lists every command', async () => {
    const code = await run(['--help'], io);
    expect(code).toBe(0);
    const help = stdout();
    for (const command of [
      'serve',
      'status',
      'search',
      'profile',
      'engagers',
      'company',
      'invite',
      'message',
      'inbox',
      'queue',
      'campaign',
      'sql',
      'export',
      'sync',
      'research',
    ]) {
      expect(help).toContain(command);
    }
    expect(help).toMatchSnapshot();
  });

  it('documents search options', async () => {
    await run(['search', '--help'], io);
    const help = stdout();
    expect(help).toContain('--source');
    expect(help).toContain('--count');
    expect(help).toContain('--csv');
    expect(help).toContain('--list');
    expect(help).toContain('--json');
  });
});

describe('with no server running', () => {
  it('tells the user how to start one', async () => {
    const code = await run(['status'], io);
    expect(code).toBe(1);
    expect(stderr()).toBe(NOT_RUNNING);
  });

  it('says the same for sql', async () => {
    await run(['sql', 'SELECT 1'], io);
    expect(stderr()).toBe(NOT_RUNNING);
  });
});

describe('status', () => {
  it('prints connection, quotas, queue and campaigns', async () => {
    await startServer();
    const code = await run(['status'], io);
    expect(code).toBe(0);
    expect(stdout()).toMatchSnapshot();
  });

  it('prints JSON with --json', async () => {
    await startServer();
    await run(['status', '--json'], io);
    expect(JSON.parse(stdout())).toMatchObject({ loggedIn: true });
  });

  it('explains pairing when the extension is not connected', async () => {
    await startServer();
    await harness!.ext.close();
    await new Promise((r) => setTimeout(r, 30));
    await run(['status'], io);
    expect(stdout()).toContain('Extension: NOT CONNECTED');
    expect(stdout()).toContain('Settings > Bridge');
  });
});

describe('search', () => {
  it('prints a table of profiles', async () => {
    await startServer();
    await run(['search', 'platform engineer'], io);
    expect(stdout()).toContain('ada-lovelace');
    expect(stdout()).toContain('Grace Hopper');
  });

  it('prints JSON with --json', async () => {
    await startServer();
    await run(['search', 'platform engineer', '--json'], io);
    expect(JSON.parse(stdout())).toMatchSnapshot();
  });

  it('passes source and count to the extension', async () => {
    await startServer();
    await run(['search', 'sre', '--source', 'salesnav', '--count', '1'], io);
    expect(harness!.ext.seen.at(-1)).toMatchObject({
      action: 'search.people',
      params: { keywords: 'sre', source: 'salesnav', count: 1 },
    });
  });

  it('writes a CSV with --csv', async () => {
    await startServer();
    const file = join(home, 'out.csv');
    await run(['search', 'sre', '--csv', file], io);
    const csv = readFileSync(file, 'utf8');
    expect(csv.split('\n')[0]).toBe('publicId,fullName,headline,company,location');
    expect(csv).toContain('Ada Lovelace');
    expect(stdout()).toContain(`Wrote 2 profiles to ${file}`);
  });

  it('saves to an existing list with --list', async () => {
    await startServer();
    await run(['search', 'sre', '--list', 'Engineering leaders'], io);
    expect(harness!.ext.seen.map((s) => s.action)).toContain('list.add');
    expect(stdout()).toContain('Saved 2 to list "Engineering leaders"');
  });

  it('creates the list first when it does not exist', async () => {
    await startServer();
    await run(['search', 'sre', '--list', 'Brand new list'], io);
    const actions = harness!.ext.seen.map((s) => s.action);
    expect(actions).toContain('list.create');
    expect(actions).toContain('list.add');
  });
});

describe('profile, company, engagers', () => {
  it('prints one profile', async () => {
    await startServer();
    await run(['profile', 'https://www.linkedin.com/in/grace-hopper/'], io);
    expect(stdout()).toContain('Grace Hopper');
    expect(harness!.ext.seen.at(-1)?.params).toEqual({ publicId: 'grace-hopper' });
  });

  it('asks for the full capture with --full', async () => {
    await startServer();
    await run(['profile', 'ada-lovelace', '--full'], io);
    expect(harness!.ext.seen.at(-1)?.params).toEqual({ publicId: 'ada-lovelace', full: true });
  });

  it('prints a company and its employees', async () => {
    await startServer();
    await run(['company', 'https://www.linkedin.com/company/difference-engine/', '--employees'], io);
    expect(stdout()).toContain('Difference Engine Ltd (difference-engine)');
    expect(stdout()).toContain('ada-lovelace');
  });

  it('lists post engagers', async () => {
    await startServer();
    await run(['engagers', 'https://www.linkedin.com/feed/update/1/', '--kind', 'likes'], io);
    expect(harness!.ext.seen.at(-1)?.params).toMatchObject({ kind: 'likes' });
    expect(stdout()).toContain('like');
  });
});

describe('writes', () => {
  it('reports a queued invite and how to approve it', async () => {
    await startServer();
    await run(['invite', 'ada-lovelace', '--note', 'Hi Ada'], io);
    expect(stdout()).toContain('Queued for approval (q_2)');
    expect(stdout()).toContain('lit queue approve q_2');
  });

  it('previews with --dry-run', async () => {
    await startServer();
    await run(['invite', 'ada-lovelace', '--dry-run'], io);
    expect(harness!.ext.seen.at(-1)?.params).toMatchObject({ dry_run: true });
    expect(stdout()).toContain('Invite dryRun');
  });

  it('sends a message', async () => {
    await startServer();
    await run(['message', 'ada-lovelace', '--body', 'hello there'], io);
    expect(harness!.ext.seen.at(-1)?.params).toMatchObject({ body: 'hello there' });
  });

  it('surfaces a quota error with its howToFix', async () => {
    const handlers = defaultHandlers();
    handlers['outreach.invite'] = () => {
      const error: any = new Error('Daily invite cap reached');
      error.name = 'FakeError';
      error.code = 'QUOTA_EXCEEDED';
      error.extra = { howToFix: 'The 100/day cap is hard. Try again tomorrow.' };
      throw error;
    };
    await startServer(handlers);
    const code = await run(['invite', 'ada-lovelace'], io);
    expect(code).toBe(1);
    expect(stderr()).toContain('Daily invite cap reached');
  });
});

describe('inbox and queue', () => {
  it('lists threads with a since window', async () => {
    await startServer();
    await run(['inbox', '--since', '24h', '--sentiment'], io);
    expect(typeof harness!.ext.seen.at(-1)?.params.since).toBe('number');
    expect(stdout()).toContain('sentiment');
    expect(stdout()).toContain('positive');
  });

  it('lists the pending queue by default', async () => {
    await startServer();
    await run(['queue'], io);
    expect(harness!.ext.seen.at(-1)).toMatchObject({
      action: 'queue.list',
      params: { status: 'pending' },
    });
    expect(stdout()).toContain('q_1');
    expect(stdout()).toContain('Ada Lovelace');
  });

  it('approves and rejects by id', async () => {
    await startServer();
    await run(['queue', 'approve', 'q_1', 'q_2'], io);
    expect(harness!.ext.seen.at(-1)).toMatchObject({
      action: 'queue.approve',
      params: { ids: ['q_1', 'q_2'] },
    });
    expect(stdout()).toContain('Approved 2');

    out = [];
    await run(['queue', 'reject', 'q_3'], io);
    expect(stdout()).toContain('Rejected 1');
  });

  it('refuses approve with no ids', async () => {
    await startServer();
    const code = await run(['queue', 'approve'], io);
    expect(code).toBe(1);
    expect(stderr()).toContain('at least one id');
  });
});

describe('campaign', () => {
  it('creates a campaign from a JSON file and a list', async () => {
    await startServer();
    const file = join(home, 'sequence.json');
    writeFileSync(
      file,
      JSON.stringify({
        name: 'Warm intro',
        steps: [{ type: 'view' }, { type: 'invite', note: 'Hi {{firstName}}' }],
      }),
      'utf8',
    );
    await run(['campaign', 'create', '--from', file, '--list', 'Engineering leaders'], io);
    expect(harness!.ext.seen.at(-1)).toMatchObject({
      action: 'campaign.create',
      params: { name: 'Warm intro', listId: 'list_1' },
    });
    expect(stdout()).toContain('Created campaign "Warm intro"');
  });

  it('fails clearly when the named list does not exist', async () => {
    await startServer();
    const file = join(home, 'sequence.json');
    writeFileSync(file, JSON.stringify({ name: 'x', steps: [] }), 'utf8');
    const code = await run(['campaign', 'create', '--from', file, '--list', 'Nope'], io);
    expect(code).toBe(1);
    expect(stderr()).toContain('No list named "Nope"');
  });

  it('lists campaigns with their stats', async () => {
    await startServer();
    await run(['campaign', 'list'], io);
    expect(stdout()).toContain('camp_1');
    expect(stdout()).toContain('Warm intro');
  });

  it('pauses and resumes', async () => {
    await startServer();
    await run(['campaign', 'pause', 'camp_1'], io);
    expect(stdout()).toContain('is now paused');
    out = [];
    await run(['campaign', 'resume', 'camp_1'], io);
    expect(stdout()).toContain('is now active');
  });
});

describe('sync, sql and export', () => {
  it('syncs and reports what changed', async () => {
    await startServer();
    await run(['sync'], io);
    expect(stdout()).toContain('profiles: 2');
    expect(stdout()).toContain('Mirror now holds 2 profiles');
  });

  it('queries the mirror', async () => {
    await startServer();
    await run(['sync'], io);
    out = [];
    await run(['sql', 'SELECT full_name FROM profiles ORDER BY public_id'], io);
    expect(stdout()).toContain('Ada Lovelace');
    expect(stdout()).toContain('Grace Hopper');
  });

  it('refuses a write query', async () => {
    await startServer();
    const code = await run(['sql', 'DELETE FROM profiles'], io);
    expect(code).toBe(1);
    expect(stderr()).toMatch(/read-only/i);
  });

  it('exports a table to CSV', async () => {
    await startServer();
    await run(['sync'], io);
    const file = join(home, 'profiles.csv');
    await run(['export', '--table', 'profiles', '--csv', file], io);
    expect(readFileSync(file, 'utf8')).toContain('Ada Lovelace');
  });

  it('rejects an unknown table', async () => {
    await startServer();
    const code = await run(['export', '--table', 'secrets', '--csv', join(home, 'x.csv')], io);
    expect(code).toBe(1);
    expect(stderr()).toContain('Unknown table "secrets"');
  });
});

describe('serve --http', () => {
  it('starts the bridge and the HTTP server and prints the pairing token', async () => {
    const { serve } = await import('../src/cli.js');
    const handles = await serve({ http: true, port: 0, bridgePort: 0 }, io);
    try {
      const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
      expect(stdout()).toContain(config.token);
      expect(stdout()).toContain('Settings > Bridge');
      expect(stdout()).toContain('Ctrl-C to stop');

      const response = await fetch(`${handles.http!.url}/health`);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        extensionConnected: false,
      });

      // The port was overridden, so the rest of the CLI can only find the
      // server through the runtime file serve() wrote.
      const runtime = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8'));
      expect(runtime.httpPort).toBe(handles.http!.port);
      expect(runtime.httpPort).not.toBe(config.httpPort);

      out = [];
      const code = await run(['status'], io);
      expect(code).toBe(0);
      expect(stdout()).toContain('Extension: NOT CONNECTED');
    } finally {
      await handles.stop();
    }
    expect(existsSync(join(home, 'server.json'))).toBe(false);
  });
});

describe('research', () => {
  it('polls the job and writes packs plus output.csv', async () => {
    let calls = 0;
    const handlers = defaultHandlers();
    handlers['research.get'] = () => {
      calls++;
      return calls < 2
        ? { jobId: 'job_1', status: 'running', done: 0, total: 1, packs: [] }
        : { jobId: 'job_1', status: 'completed', done: 1, total: 1, packs: [pack] };
    };
    await startServer(handlers);

    const input = join(home, 'rows.csv');
    writeFileSync(input, 'name,company\nAda Lovelace,Difference Engine Ltd\n', 'utf8');
    const outDir = join(home, 'packs');

    const code = await run(
      ['research', input, '--out', outDir, '--poll', '5', '--list', 'Research'],
      io,
    );
    expect(code).toBe(0);

    expect(harness!.ext.seen.find((s) => s.action === 'research.pack')?.params).toMatchObject({
      rows: [{ name: 'Ada Lovelace', company: 'Difference Engine Ltd' }],
      listName: 'Research',
    });
    expect(existsSync(join(outDir, 'ada-lovelace', 'pack.md'))).toBe(true);
    expect(readFileSync(join(outDir, 'ada-lovelace', 'pack.md'), 'utf8')).toBe(pack.markdown);
    expect(JSON.parse(readFileSync(join(outDir, 'ada-lovelace', 'pack.json'), 'utf8')).signals).toEqual(
      pack.signals,
    );
    expect(readFileSync(join(outDir, 'output.csv'), 'utf8')).toContain('ada-lovelace');
    expect(stdout()).toContain('Researching 1 rows');
    expect(stdout()).toContain('1/1 packs');
  });

  it('refuses an empty CSV', async () => {
    await startServer();
    const input = join(home, 'empty.csv');
    mkdirSync(home, { recursive: true });
    writeFileSync(input, 'name\n', 'utf8');
    const code = await run(['research', input], io);
    expect(code).toBe(1);
    expect(stderr()).toContain('has no rows');
  });
});
