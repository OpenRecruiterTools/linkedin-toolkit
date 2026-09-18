/**
 * `lit endpoints check` — the command someone runs after a LinkedIn release
 * breaks one query id and nothing says which.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpServer } from '../src/http.js';
import { saveConfig, type ServerConfig } from '../src/config.js';
import { run, endpointNote } from '../src/cli.js';
import { diagnose, doctorReport } from '../src/endpoints.js';
import { makeHarness, TEST_TOKEN, type Harness } from './helpers.js';
import { defaultHandlers, status } from './fixtures.js';
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

/** A verify-aware status handler over a given endpoint report. */
function handlersReporting(
  endpoints: Record<string, string>,
  extra: Record<string, unknown> = {},
): Handlers {
  const handlers = defaultHandlers();
  handlers['status.get'] = (params: any) => ({
    ...status,
    ...(params?.verify
      ? { endpoints, clientVersionCaptured: '1.13.35548', ...extra }
      : {}),
  });
  return handlers;
}

async function startServer(handlers: Handlers): Promise<void> {
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
  out = [];
  err = [];
}

beforeEach(() => {
  out = [];
  err = [];
  previousHome = process.env.LINKEDIN_TOOLKIT_HOME;
  home = mkdtempSync(join(tmpdir(), 'lit-ep-'));
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

describe('endpointNote', () => {
  it('reports the client version an ok endpoint was verified against', () => {
    expect(endpointNote('ok', '1.13.35548')).toBe('verified 1.13.35548');
  });

  it('points a failure at recapturing, and carries the error when there is one', () => {
    expect(endpointNote('failed', '1.13.35548')).toMatch(/LinkedIn likely moved/);
    expect(endpointNote('failed', '1.13.35548', 'HTTP 400')).toContain('HTTP 400');
    expect(endpointNote('failed', '1.13.35548', 'HTTP 400')).toContain('voyager-endpoints.md');
  });

  it('says plainly when an endpoint has never been verified', () => {
    expect(endpointNote('unverified', '1.13.35548')).toBe(
      'not yet verified against the current LinkedIn client',
    );
  });

  it('explains a skip', () => {
    expect(endpointNote('skipped', '1.13.35548')).toMatch(/nothing to check it against/);
  });
});

describe('lit endpoints check', () => {
  it('asks the extension to verify', async () => {
    await startServer(handlersReporting({ me: 'ok', search: 'ok' }));
    await run(['endpoints', 'check'], io);
    expect(harness!.ext.seen.at(-1)).toMatchObject({
      action: 'status.get',
      params: { verify: true },
    });
  });

  it('prints name, result and note, and exits 0 when everything is ok', async () => {
    await startServer(
      handlersReporting({ me: 'ok', search: 'ok', groupMembers: 'unverified', reactions: 'skipped' }),
    );
    const code = await run(['endpoints', 'check'], io);
    expect(code).toBe(0);

    const text = stdout();
    expect(text).toContain('name');
    expect(text).toContain('result');
    expect(text).toContain('note');
    expect(text).toMatch(/me\s+ok\s+verified 1\.13\.35548/);
    expect(text).toMatch(/groupMembers\s+unverified\s+not yet verified/);
    expect(text).toMatch(/reactions\s+skipped/);
  });

  it('exits 2 and names the failure when an endpoint is broken', async () => {
    await startServer(
      handlersReporting(
        { me: 'ok', memberPosts: 'failed' },
        { endpointErrors: { memberPosts: 'HTTP 400 from graphql' } },
      ),
    );
    const code = await run(['endpoints', 'check'], io);
    expect(code).toBe(2);

    const text = stdout();
    expect(text).toMatch(/memberPosts\s+failed\s+HTTP 400 from graphql/);
    expect(text).toContain('1 endpoint failed');
    expect(text).toContain('voyager-endpoints.md');
    // The exit code carries the failure; there is no empty error line.
    expect(err.join('')).toBe('');
  });

  it('counts more than one failure in the summary line', async () => {
    await startServer(handlersReporting({ memberPosts: 'failed', reactions: 'failed' }));
    expect(await run(['endpoints', 'check'], io)).toBe(2);
    expect(stdout()).toContain('2 endpoints failed');
  });

  it('passes a probe post through with --post', async () => {
    await startServer(handlersReporting({ reactions: 'ok' }));
    await run(
      ['endpoints', 'check', '--post', 'https://www.linkedin.com/feed/update/1/'],
      io,
    );
    expect(harness!.ext.seen.at(-1)?.params).toMatchObject({
      verify: true,
      postUrl: 'https://www.linkedin.com/feed/update/1/',
    });
  });

  it('prints the raw envelope with --json, and still exits 2 on a failure', async () => {
    await startServer(handlersReporting({ me: 'ok', search: 'failed' }));
    const code = await run(['endpoints', 'check', '--json'], io);
    expect(code).toBe(2);
    const data = JSON.parse(stdout());
    expect(data.endpoints).toEqual({ me: 'ok', search: 'failed' });
    expect(data.clientVersionCaptured).toBe('1.13.35548');
  });

  it('is documented in the help', async () => {
    await run(['endpoints', '--help'], io);
    expect(stdout()).toContain('check');
    out = [];
    await run(['endpoints', 'check', '--help'], io);
    expect(stdout()).toContain('--post');
    expect(stdout()).toContain('Exits 2');
  });
});

describe('doctorReport', () => {
  it('says nothing needs re-capturing when everything answers', () => {
    const report = doctorReport({
      endpoints: { me: 'ok', search: 'ok', groupMembers: 'unverified' },
      clientVersionCaptured: '1.13.46474',
      endpointsCapturedAt: '2026-09-08',
    });
    expect(report.failed).toEqual([]);
    expect(report.text).toContain('Every verified endpoint still answers');
    expect(report.text).toContain('1.13.46474');
  });

  it('names the stale hash, the file it lives in, and how to re-capture it', () => {
    const report = doctorReport({
      endpoints: { me: 'ok', search: 'failed' },
      errors: { search: 'Voyager API error 400' },
    });
    expect(report.failed).toEqual(['search']);
    expect(report.text).toContain('Voyager API error 400');
    expect(report.text).toContain('voyagerSearchDashClusters.');
    expect(report.text).toContain('ENDPOINTS.queryIds.searchClusters');
    expect(report.text).toContain('extension/src/background/voyager.js');
    expect(report.text).toContain('docs/voyager-endpoints.md#re-capturing');
  });

  it('points a REST failure at its decoration id instead of a query id', () => {
    const report = doctorReport({ endpoints: { connections: 'failed' } });
    expect(report.text).toContain('ENDPOINTS.decorations.connectionList');
    expect(report.text).toContain('No query id here');
  });

  it('handles a check name it has never heard of', () => {
    const report = doctorReport({ endpoints: { somethingNew: 'failed' } });
    expect(report.text).toContain('not in the drift table');
    expect(report.text).toContain('lit endpoints check --json');
  });

  it('says that no CI job can run this, because it needs a real session', () => {
    const report = doctorReport({ endpoints: { search: 'failed' } });
    expect(report.text).toMatch(/No CI job can run this check/);
  });

  it('diagnoses one endpoint on its own', () => {
    expect(diagnose('memberPosts', 'HTTP 400').join('\n')).toContain(
      'voyagerFeedDashProfileUpdates.',
    );
  });
});

describe('lit endpoints doctor', () => {
  it('verifies, then explains, and exits 0 when nothing is broken', async () => {
    await startServer(handlersReporting({ me: 'ok', search: 'ok' }));
    const code = await run(['endpoints', 'doctor'], io);
    expect(code).toBe(0);
    expect(harness!.ext.seen.at(-1)).toMatchObject({
      action: 'status.get',
      params: { verify: true },
    });
    expect(stdout()).toContain('Every verified endpoint still answers');
  });

  it('exits 2 and tells the user exactly what to edit', async () => {
    await startServer(
      handlersReporting(
        { me: 'ok', memberPosts: 'failed' },
        { endpointErrors: { memberPosts: 'Voyager API error 400' } },
      ),
    );
    expect(await run(['endpoints', 'doctor'], io)).toBe(2);
    const text = stdout();
    expect(text).toContain('memberPosts — failed: Voyager API error 400');
    expect(text).toContain('ENDPOINTS.queryIds.memberPosts');
    expect(text).toContain('docs/voyager-endpoints.md#re-capturing');
  });

  it('adds the raw check output with --json, for the issue template', async () => {
    await startServer(handlersReporting({ me: 'ok', search: 'failed' }));
    expect(await run(['endpoints', 'doctor', '--json'], io)).toBe(2);
    const text = stdout();
    const json = JSON.parse(text.slice(text.indexOf('{')));
    expect(json.endpoints).toEqual({ me: 'ok', search: 'failed' });
  });

  it('takes a probe post like check does', async () => {
    await startServer(handlersReporting({ reactions: 'ok' }));
    await run(['endpoints', 'doctor', '--post', 'https://www.linkedin.com/feed/update/1/'], io);
    expect(harness!.ext.seen.at(-1)?.params).toMatchObject({
      verify: true,
      postUrl: 'https://www.linkedin.com/feed/update/1/',
    });
  });

  it('is documented in the help', async () => {
    await run(['endpoints', '--help'], io);
    expect(stdout()).toContain('doctor');
  });
});

describe('lit endpoints check in fake mode', () => {
  it('reports the bundled demo endpoint table', async () => {
    const { serve } = await import('../src/cli.js');
    const handles = await serve({ http: true, port: 0, bridgePort: 0, fake: true }, io);
    try {
      out = [];
      const code = await run(['endpoints', 'check'], io);
      expect(code).toBe(0);
      expect(stdout()).toMatch(/me\s+ok\s+verified/);
      expect(stdout()).toMatch(/reactions\s+skipped/);
      expect(stdout()).toMatch(/groupMembers\s+unverified/);
    } finally {
      await handles.stop();
    }
  });
});
