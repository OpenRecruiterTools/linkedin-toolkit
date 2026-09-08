import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { HttpServer } from '../src/http.js';
import { TOOL_NAMES } from '../src/contract.js';
import { FAKE_RATE_LIMIT } from '../src/fake-extension.js';
import { makeHarness, TEST_TOKEN, type Harness } from './helpers.js';
import { ada } from './fixtures.js';

let harness: Harness;
let http: HttpServer;
let base: string;

const auth = { authorization: `Bearer ${TEST_TOKEN}`, 'content-type': 'application/json' };

async function post(path: string, body: unknown, headers: Record<string, string> = auth) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

beforeEach(async () => {
  harness = await makeHarness();
  http = new HttpServer({ toolkit: harness.toolkit, port: 0 });
  await http.start();
  base = http.url;
});

afterEach(async () => {
  await http.stop();
  await harness.stop();
});

describe('GET /health', () => {
  it('needs no token and reports the extension connection', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      extensionConnected: true,
      version: '2.0.0',
    });
  });

  it('reports extensionConnected false once the extension goes away', async () => {
    await harness.ext.close();
    await new Promise((r) => setTimeout(r, 30));
    const body = await (await fetch(`${base}/health`)).json();
    expect(body.extensionConnected).toBe(false);
  });
});

describe('GET /openapi.json', () => {
  it('serves a 3.1 document with a path per action and per tool', async () => {
    const response = await fetch(`${base}/openapi.json`);
    const doc = await response.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/actions/search.people'].post.requestBody).toBeDefined();
    expect(doc.paths['/actions/outreach.invite'].post.description).toMatch(/write action/);
    for (const name of TOOL_NAMES) expect(doc.paths[`/tools/${name}`]).toBeDefined();
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('describes search.people params from the contract', async () => {
    const doc = await (await fetch(`${base}/openapi.json`)).json();
    const schema = doc.paths['/actions/search.people'].post.requestBody.content['application/json'].schema;
    expect(schema.required).toContain('keywords');
    expect(schema.properties.count.maximum).toBe(100);
  });
});

describe('authentication', () => {
  it('401s without a token', async () => {
    const { status, body } = await post('/actions/status.get', {}, { 'content-type': 'application/json' });
    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('401s with the wrong token', async () => {
    const { status } = await post('/actions/status.get', {}, {
      authorization: 'Bearer nope',
      'content-type': 'application/json',
    });
    expect(status).toBe(401);
  });
});

describe('POST /actions/{action}', () => {
  it('returns a success envelope', async () => {
    const { status, body } = await post('/actions/status.get', {});
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
    expect(body.data.loggedIn).toBe(true);
  });

  it('passes params to the extension', async () => {
    await post('/actions/search.people', { keywords: 'sre', count: 1 });
    expect(harness.ext.seen.at(-1)).toMatchObject({
      action: 'search.people',
      params: { keywords: 'sre', count: 1 },
    });
  });

  it('mirrors results into SQLite', async () => {
    await post('/actions/search.people', { keywords: 'sre' });
    expect(harness.toolkit.db.counts().profiles).toBe(2);
  });

  it('carries rateLimit through from the extension on an outreach action', async () => {
    const { body } = await post('/actions/outreach.invite', { publicId: 'ada-lovelace' });
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ status: 'queued' });
    expect(body.rateLimit).toEqual(FAKE_RATE_LIMIT);
  });

  it('leaves rateLimit off an envelope the extension did not send one with', async () => {
    const { body } = await post('/actions/status.get', {});
    expect(body.ok).toBe(true);
    expect('rateLimit' in body).toBe(false);
  });

  it('carries rateLimit through the /tools route as well', async () => {
    const { body } = await post('/tools/linkedin_send_invite', { publicId: 'ada-lovelace' });
    expect(body.ok).toBe(true);
    expect(body.rateLimit).toEqual(FAKE_RATE_LIMIT);
  });

  it('rejects bad params with INVALID_PARAMS before calling the extension', async () => {
    const before = harness.ext.seen.length;
    const { status, body } = await post('/actions/search.people', { count: 5 });
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAMS');
    expect(body.error.message).toContain('keywords');
    expect(harness.ext.seen.length).toBe(before);
  });

  it('404s an unknown action', async () => {
    const { status, body } = await post('/actions/does.not.exist', {});
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON', async () => {
    const response = await fetch(`${base}/actions/status.get`, {
      method: 'POST',
      headers: auth,
      body: '{oops',
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_PARAMS');
  });

  it('passes dry_run through on a write action', async () => {
    const { body } = await post('/actions/outreach.invite', {
      publicId: ada.publicId,
      dry_run: true,
    });
    expect(body.data.status).toBe('dryRun');
  });

  it('returns an error envelope with 200 when the extension refuses', async () => {
    await harness.ext.close();
    await new Promise((r) => setTimeout(r, 30));
    const { status, body } = await post('/actions/status.get', {});
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('EXTENSION_OFFLINE');
    expect(body.error.howToFix).toContain('pairing token');
  });
});

describe('POST /tools/{tool}', () => {
  it('runs a bridge-backed tool', async () => {
    const { body } = await post('/tools/linkedin_get_status', {});
    expect(body.ok).toBe(true);
    expect(body.data.autopilot).toBe(false);
  });

  it('runs the server-local SQL tool', async () => {
    await post('/actions/search.people', { keywords: 'x' });
    const { body } = await post('/tools/linkedin_query_sql', {
      sql: 'SELECT COUNT(*) AS n FROM profiles',
    });
    expect(body.data.rows[0].n).toBe(2);
  });

  it('runs linkedin_sync', async () => {
    const { body } = await post('/tools/linkedin_sync', {});
    expect(body.data.counts.profiles).toBe(2);
  });

  it('404s an unknown tool', async () => {
    const { status } = await post('/tools/linkedin_nope', {});
    expect(status).toBe(404);
  });
});

describe('request origin', () => {
  it('is mcp by default', async () => {
    await post('/actions/status.get', {});
    expect(harness.ext.seen.at(-1)?.origin).toBe('mcp');
  });

  it('is cli when the CLI origin header is present', async () => {
    await post('/actions/status.get', {}, { ...auth, 'x-linkedin-toolkit-origin': 'cli' });
    expect(harness.ext.seen.at(-1)?.origin).toBe('cli');
  });

  it('ignores an unrecognised origin header and stays mcp', async () => {
    await post('/actions/status.get', {}, { ...auth, 'x-linkedin-toolkit-origin': 'popup' });
    expect(harness.ext.seen.at(-1)?.origin).toBe('mcp');
  });

  it('travels on tool routes too', async () => {
    await post('/tools/linkedin_get_status', {}, { ...auth, 'x-linkedin-toolkit-origin': 'cli' });
    expect(harness.ext.seen.at(-1)?.origin).toBe('cli');
    await post('/tools/linkedin_sync', {});
    expect(harness.ext.seen.at(-1)?.origin).toBe('mcp');
  });
});

describe('CORS', () => {
  it('allows a localhost origin', async () => {
    const response = await fetch(`${base}/health`, { headers: { origin: 'http://localhost:3000' } });
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('does not allow a remote origin', async () => {
    const response = await fetch(`${base}/health`, { headers: { origin: 'https://example.com' } });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers a preflight', async () => {
    const response = await fetch(`${base}/actions/status.get`, {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:5173' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'x-linkedin-toolkit-origin',
    );
  });
});

describe('POST /mcp', () => {
  it('serves the full tool list over Streamable HTTP', async () => {
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${TEST_TOKEN}` } },
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(39);
    const result: any = await client.callTool({ name: 'linkedin_get_status', arguments: {} });
    expect(JSON.parse(result.content[0].text).loggedIn).toBe(true);
    await client.close();
  });

  it('401s without the bearer token', async () => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
  });
});
