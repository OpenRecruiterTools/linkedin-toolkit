import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTIONS,
  ACTION_METHODS,
  DEFAULT_BASE_URL,
  LinkedInToolkit,
  LinkedInToolkitError,
  resolveConfig,
} from '../src/index.js';
import { MockServer, closedPort } from './mock-server.js';

const server = new MockServer();

beforeAll(() => server.start());
afterAll(() => server.stop());
beforeEach(() => {
  server.requests.length = 0;
  server.respondWithData({});
});

function client(overrides: Record<string, unknown> = {}): LinkedInToolkit {
  return new LinkedInToolkit({ baseUrl: server.baseUrl, token: 'test-token', ...overrides });
}

describe('config resolution', () => {
  const env = (values: Record<string, string | undefined>): NodeJS.ProcessEnv =>
    ({ ...values }) as NodeJS.ProcessEnv;

  it('falls back to the documented default with nothing configured', () => {
    const resolved = resolveConfig({}, env({ LINKEDIN_TOOLKIT_HOME: mkdtempSync(join(tmpdir(), 'lit-empty-')) }));
    expect(resolved.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(resolved.baseUrlSource).toBe('default');
    expect(resolved.token).toBeUndefined();
    expect(resolved.tokenSource).toBe('none');
  });

  it('prefers explicit options over everything else', () => {
    const home = mkdtempSync(join(tmpdir(), 'lit-home-'));
    writeFileSync(join(home, 'config.json'), JSON.stringify({ token: 'from-file', httpPort: 5000 }));
    writeFileSync(join(home, 'server.json'), JSON.stringify({ httpPort: 6000 }));
    const resolved = resolveConfig(
      { baseUrl: 'http://127.0.0.1:1234/', token: 'explicit' },
      env({ LINKEDIN_TOOLKIT_HOME: home, LINKEDIN_TOOLKIT_URL: 'http://x', LINKEDIN_TOOLKIT_TOKEN: 'y' }),
    );
    expect(resolved.baseUrl).toBe('http://127.0.0.1:1234');
    expect(resolved.token).toBe('explicit');
    expect(resolved.baseUrlSource).toBe('option');
    expect(resolved.tokenSource).toBe('option');
  });

  it('prefers the environment over the files', () => {
    const home = mkdtempSync(join(tmpdir(), 'lit-home-'));
    writeFileSync(join(home, 'server.json'), JSON.stringify({ httpPort: 6000 }));
    writeFileSync(join(home, 'config.json'), JSON.stringify({ token: 'from-file' }));
    const resolved = resolveConfig(
      {},
      env({
        LINKEDIN_TOOLKIT_HOME: home,
        LINKEDIN_TOOLKIT_URL: 'http://127.0.0.1:9999',
        LINKEDIN_TOOLKIT_TOKEN: 'from-env',
      }),
    );
    expect(resolved.baseUrl).toBe('http://127.0.0.1:9999');
    expect(resolved.baseUrlSource).toBe('env');
    expect(resolved.token).toBe('from-env');
    expect(resolved.tokenSource).toBe('env');
  });

  it('prefers the port a running server bound over the configured one', () => {
    const home = mkdtempSync(join(tmpdir(), 'lit-home-'));
    writeFileSync(join(home, 'config.json'), JSON.stringify({ token: 'tok', httpPort: 47830 }));
    writeFileSync(join(home, 'server.json'), JSON.stringify({ httpPort: 9000, bridgePort: 9001 }));
    const resolved = resolveConfig({}, env({ LINKEDIN_TOOLKIT_HOME: home }));
    expect(resolved.baseUrl).toBe('http://127.0.0.1:9000');
    expect(resolved.baseUrlSource).toBe('server.json');
    expect(resolved.token).toBe('tok');
    expect(resolved.tokenSource).toBe('config.json');
  });

  it('uses the configured port when no server is running', () => {
    const home = mkdtempSync(join(tmpdir(), 'lit-home-'));
    writeFileSync(join(home, 'config.json'), JSON.stringify({ token: 'tok', httpPort: 47999 }));
    const resolved = resolveConfig({}, env({ LINKEDIN_TOOLKIT_HOME: home }));
    expect(resolved.baseUrl).toBe('http://127.0.0.1:47999');
    expect(resolved.baseUrlSource).toBe('config.json');
  });

  it('ignores a corrupt config file instead of throwing', () => {
    const home = mkdtempSync(join(tmpdir(), 'lit-home-'));
    writeFileSync(join(home, 'config.json'), '{ not json');
    writeFileSync(join(home, 'server.json'), 'also not json');
    const resolved = resolveConfig({}, env({ LINKEDIN_TOOLKIT_HOME: home }));
    expect(resolved.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(resolved.token).toBeUndefined();
  });
});

describe('call', () => {
  it('posts params to /actions/{action} with the bearer token', async () => {
    server.respondWithData({ profiles: [], total: 0 });
    const result = await client().call('search.people', { keywords: 'CTO', count: 10 });

    expect(result).toEqual({ profiles: [], total: 0 });
    expect(server.last.method).toBe('POST');
    expect(server.last.path).toBe('/actions/search.people');
    expect(server.last.headers.authorization).toBe('Bearer test-token');
    expect(server.last.headers['content-type']).toBe('application/json');
    expect(server.last.body).toEqual({ keywords: 'CTO', count: 10 });
  });

  it('sends no origin header — clients are agent surfaces, and the server treats that as "mcp"', async () => {
    await client().statusGet();
    expect(server.last.headers['x-linkedin-toolkit-origin']).toBeUndefined();
  });

  it('sends an empty object when an action takes no params', async () => {
    await client().statusGet();
    expect(server.last.body).toEqual({});
  });

  it('turns an error envelope into LinkedInToolkitError with every field', async () => {
    server.respondWithError({
      code: 'RATE_LIMITED',
      message: 'Too many invites this hour.',
      howToFix: 'Wait for the window to reset.',
      retryAfter: 900000,
    });

    const error = await client()
      .outreachInvite({ publicId: 'someone' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LinkedInToolkitError);
    const failure = error as LinkedInToolkitError;
    expect(failure.code).toBe('RATE_LIMITED');
    expect(failure.message).toBe('Too many invites this hour.');
    expect(failure.howToFix).toBe('Wait for the window to reset.');
    expect(failure.retryAfter).toBe(900000);
    expect(failure.action).toBe('outreach.invite');
    expect(failure.terminal).toBe(true);
    expect(failure.known).toBe(true);
    expect(failure.toJSON()).toMatchObject({ code: 'RATE_LIMITED', action: 'outreach.invite' });
  });

  it('marks INVALID_PARAMS as non-terminal — it is worth another attempt', async () => {
    server.respondWithError({ code: 'INVALID_PARAMS', message: 'publicId: Required' });
    const error = (await client()
      .outreachInvite({ publicId: '' })
      .catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(error.terminal).toBe(false);
  });

  it('rejects an unknown action before touching the network', async () => {
    const before = server.requests.length;
    const error = (await client()
      .call('not.an.action' as never, {})
      .catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(error.code).toBe('NOT_FOUND');
    expect(server.requests.length).toBe(before);
  });

  it('reports an unreachable server as EXTENSION_OFFLINE with how to start it', async () => {
    const port = await closedPort();
    const error = (await new LinkedInToolkit({ baseUrl: `http://127.0.0.1:${port}`, token: 't' })
      .statusGet()
      .catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(error).toBeInstanceOf(LinkedInToolkitError);
    expect(error.code).toBe('EXTENSION_OFFLINE');
    expect(error.howToFix).toContain('lit serve --http');
  });

  it('reports a non-JSON body rather than leaking a parse error', async () => {
    server.respondWith(() => ({ status: 502, body: '<html>nope</html>' }));
    const error = (await client()
      .statusGet()
      .catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('502');
  });

  it('times out rather than hanging forever', async () => {
    // A fetch that only ever settles when the client aborts it, which is what a
    // server that accepts the socket and never answers looks like.
    const neverAnswers = ((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;

    const hanging = new LinkedInToolkit({
      baseUrl: 'http://127.0.0.1:1',
      token: 't',
      timeoutMs: 50,
      fetch: neverAnswers,
    });
    const started = Date.now();
    const error = (await hanging.statusGet().catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('timed out');
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('generated methods', () => {
  it('exposes one method per action, and nothing else', () => {
    const instance = client() as unknown as Record<string, unknown>;
    expect(Object.keys(ACTION_METHODS).sort()).toEqual([...ACTIONS].sort());
    for (const [action, method] of Object.entries(ACTION_METHODS)) {
      expect(typeof instance[method], `${action} -> ${method}`).toBe('function');
    }
  });

  it('names methods by flattening the action', () => {
    expect(ACTION_METHODS['search.people']).toBe('searchPeople');
    expect(ACTION_METHODS['network.unfollowCount']).toBe('networkUnfollowCount');
    expect(ACTION_METHODS['list.getAll']).toBe('listGetAll');
    expect(ACTION_METHODS['export.csv']).toBe('exportCsv');
  });

  it('routes every method to its own action path', async () => {
    const instance = client() as unknown as Record<string, (params?: unknown) => Promise<unknown>>;
    for (const [action, method] of Object.entries(ACTION_METHODS)) {
      server.requests.length = 0;
      await instance[method]({} as never).catch(() => undefined);
      expect(server.last.path).toBe(`/actions/${action}`);
    }
  });

  it('passes dry_run through for write actions', async () => {
    await client().outreachInvite({ publicId: 'someone', note: 'hi', dry_run: true });
    expect(server.last.body).toEqual({ publicId: 'someone', note: 'hi', dry_run: true });
  });

  it('reports a queued write as the success it is', async () => {
    server.respondWithData({ status: 'queued', queueId: 'q_1' });
    const result = await client().outreachMessage({ publicId: 'someone', body: 'hello' });
    expect(result).toEqual({ status: 'queued', queueId: 'q_1' });
  });
});

describe('callTool', () => {
  it('posts to /tools/{tool}', async () => {
    server.respondWithData({ columns: ['n'], rows: [[1]], rowCount: 1, truncated: false });
    const result = await client().callTool('linkedin_query_sql', { sql: 'SELECT 1 AS n' });
    expect(server.last.path).toBe('/tools/linkedin_query_sql');
    expect(server.last.body).toEqual({ sql: 'SELECT 1 AS n' });
    expect(result).toMatchObject({ rowCount: 1 });
  });
});

describe('the research pack tool', () => {
  /** A fetch that answers after `delayMs`, or rejects the moment it is aborted. */
  const slowFetch = (delayMs: number) =>
    ((_url: string, init: { signal: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            resolve(
              new Response(JSON.stringify({ id: 'r', ok: true, data: { jobId: 'j_1' } }), {
                headers: { 'content-type': 'application/json' },
              }),
            ),
          delayMs,
        );
        init.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      })) as unknown as typeof fetch;

  it('outlives a client timeout that any other tool would hit', async () => {
    // The server blocks on /tools/linkedin_research_pack for up to its
    // researchTimeoutMs (10 min by default). A default-timeout client would
    // abandon a run that is going perfectly well.
    const instance = new LinkedInToolkit({
      baseUrl: server.baseUrl,
      token: 't',
      timeoutMs: 60,
      fetch: slowFetch(250),
    });

    await expect(instance.callTool('linkedin_research_pack', { rows: [] })).resolves.toEqual({
      jobId: 'j_1',
    });

    const abandoned = (await instance
      .callTool('linkedin_sync', {})
      .catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(abandoned.code).toBe('INTERNAL');
    expect(abandoned.message).toContain('timed out after 60 ms');
  });

  it('never lowers a timeout the caller deliberately raised', async () => {
    const instance = new LinkedInToolkit({ baseUrl: server.baseUrl, token: 't', timeoutMs: 900_000 });
    server.respondWithData({ jobId: 'j_2' });
    await expect(instance.callTool('linkedin_research_pack', { rows: [] })).resolves.toEqual({
      jobId: 'j_2',
    });
  });
});

describe('health and tools', () => {
  it('reads /health without a token', async () => {
    server.respondWith(() => ({ body: { ok: true, extensionConnected: false, version: '2.0.0' } }));
    const health = await new LinkedInToolkit({ baseUrl: server.baseUrl }).health();
    expect(health).toEqual({ ok: true, extensionConnected: false, version: '2.0.0' });
    expect(server.last.path).toBe('/health');
    expect(server.last.headers.authorization).toBeUndefined();
  });

  it('returns 39 tool definitions with JSON Schema parameters and no network call', () => {
    const before = server.requests.length;
    const tools = client().tools();
    expect(tools).toHaveLength(39);
    expect(server.requests.length).toBe(before);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^linkedin_/);
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.parameters).toMatchObject({ type: 'object' });
    }
  });

  it('hands back a copy, so a caller mutating a definition cannot poison the next call', () => {
    const instance = client();
    instance.tools()[0].parameters.type = 'poisoned';
    expect(instance.tools()[0].parameters.type).toBe('object');
  });

  it('adds dry_run to write tools only', () => {
    const tools = client().tools();
    const invite = tools.find((t) => t.name === 'linkedin_send_invite');
    const status = tools.find((t) => t.name === 'linkedin_get_status');
    expect((invite!.parameters.properties as Record<string, unknown>).dry_run).toBeDefined();
    expect((status!.parameters.properties as Record<string, unknown>).dry_run).toBeUndefined();
  });
});
