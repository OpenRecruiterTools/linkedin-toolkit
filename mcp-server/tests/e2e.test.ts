/**
 * The end-to-end test: one Toolkit, one bridge, one HTTP server, one MCP
 * client and one webhook receiver, driven through a whole working session.
 *
 * Every other suite in this package tests a layer. This one tests that the
 * layers agree: a search made over HTTP has to end up in the same SQLite
 * mirror that an MCP tool then queries, a campaign tick has to produce a queue
 * item that a later approve can send, and the event that approve emits has to
 * reach the webhook receiver. Nothing here is stubbed except LinkedIn itself.
 *
 * Offline: the only sockets opened are on 127.0.0.1 and every one of them is
 * created by this test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Toolkit } from '../src/toolkit.js';
import { Db } from '../src/db.js';
import { Webhooks } from '../src/webhooks.js';
import { HttpServer } from '../src/http.js';
import { createMcpServer } from '../src/tools.js';
import type { ServerConfig } from '../src/config.js';
import { FakeExtension } from './fakeExtension.js';
import { E2eEngine } from './fixtures/e2eEngine.js';

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = 'e'.repeat(32);

/** A webhook receiver that remembers every delivery. */
class Receiver {
  readonly deliveries: { event: string; payload: any; at: number }[] = [];
  private server!: Server;
  url = '';

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          this.deliveries.push(JSON.parse(body));
        } catch {
          /* a malformed delivery is still a delivery we did not want */
        }
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    const address = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${address.port}/hook`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  /** Wait for a delivery of `event`, or fail the test loudly. */
  async waitFor(event: string, timeoutMs = 3000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.deliveries.find((d) => d.event === event);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(
      `no webhook delivery for ${event} within ${timeoutMs}ms; saw: ${this.deliveries
        .map((d) => d.event)
        .join(', ')}`,
    );
  }
}

let home: string;
let previousHome: string | undefined;
let engine: E2eEngine;
let ext: FakeExtension;
let toolkit: Toolkit;
let http: HttpServer;
let mcp: Client;
let receiver: Receiver;
let base: string;

const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

async function post(path: string, body: unknown, headers: Record<string, string> = auth) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

/** POST an action and insist it succeeded, returning just the data. */
async function action(name: string, params: unknown = {}): Promise<any> {
  const { status, body } = await post(`/actions/${name}`, params);
  expect(status, `${name} -> HTTP ${status} ${JSON.stringify(body)}`).toBe(200);
  expect(body.ok, `${name} -> ${JSON.stringify(body.error)}`).toBe(true);
  return body.data;
}

/** The JSON payload an agent reads out of an MCP tool result. */
function payload(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result: any = await mcp.callTool({ name, arguments: args });
  expect(result.isError, `${name} -> ${result.content?.[0]?.text}`).toBeFalsy();
  return payload(result);
}

beforeAll(async () => {
  previousHome = process.env.LINKEDIN_TOOLKIT_HOME;
  home = mkdtempSync(join(tmpdir(), 'lit-e2e-'));
  process.env.LINKEDIN_TOOLKIT_HOME = home;

  receiver = new Receiver();
  await receiver.start();

  const config: ServerConfig = {
    token: TOKEN,
    bridgePort: 0,
    httpPort: 0,
    dbPath: join(home, 'toolkit.db'),
    researchTimeoutMs: 5000,
    webhookUrl: receiver.url,
  };

  engine = new E2eEngine();
  toolkit = new Toolkit({
    config,
    db: new Db(config.dbPath),
    webhooks: new Webhooks({ url: receiver.url }),
    bridgeOptions: { port: 0, pingIntervalMs: 1000 },
  });
  await toolkit.start();

  http = new HttpServer({ toolkit, port: 0 });
  await http.start();
  base = http.url;

  ext = new FakeExtension({
    port: toolkit.bridge.port,
    token: TOKEN,
    handlers: engine.handlers(),
  });
  engine.emit = (event, payloadValue) => ext.emit(event, payloadValue);
  await ext.connect();

  const server = createMcpServer(toolkit);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  mcp = new Client({ name: 'e2e', version: '2.0.0' });
  await Promise.all([mcp.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await mcp?.close();
  await ext?.close();
  await http?.stop();
  await toolkit?.stop();
  await receiver?.stop();
  if (previousHome === undefined) delete process.env.LINKEDIN_TOOLKIT_HOME;
  else process.env.LINKEDIN_TOOLKIT_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('the whole flow, HTTP and MCP against one toolkit', () => {
  /** Carried between the ordered steps below. */
  const state: { listId?: string; campaignId?: string; queueId?: string; jobId?: string } = {};

  it('is healthy and paired before anything else', async () => {
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({ ok: true, extensionConnected: true, version: '2.0.0' });

    const status = await tool('linkedin_get_status');
    expect(status.loggedIn).toBe(true);
    expect(status.autopilot).toBe(false);
    expect(Object.keys(status.quotas).sort()).toEqual(['invite', 'message', 'search', 'visit']);
  });

  it('searches for people over HTTP and mirrors them', async () => {
    const data = await action('search.people', { keywords: 'head of platform', count: 2 });
    expect(data.profiles).toHaveLength(2);
    expect(data.profiles[0].publicId).toBe('ada-lovelace');
    expect(ext.seen.at(-1)).toMatchObject({ action: 'search.people', origin: 'mcp' });
  });

  it('creates a list and adds the search results to it', async () => {
    const list = await action('list.create', { name: 'Platform leads', tags: ['e2e'] });
    expect(list.listId).toBeTruthy();
    state.listId = list.listId;

    const added = await action('list.add', {
      listId: list.listId,
      publicIds: ['ada-lovelace', 'grace-hopper'],
    });
    expect(added).toEqual({ added: 2, duplicates: 0 });

    const members = await action('list.members', { listId: list.listId });
    expect(members.total).toBe(2);
  });

  it('creates a campaign from the shipped warm-connect sequence', async () => {
    const file = resolve(here, '../../sequences/warm-connect.json');
    const sequence = JSON.parse(readFileSync(file, 'utf8'));
    expect(sequence.steps.length).toBeGreaterThan(3);

    const campaign = await action('campaign.create', {
      name: sequence.name,
      steps: sequence.steps,
      settings: sequence.settings,
    });
    expect(campaign.status).toBe('active');
    expect(campaign.steps[0]).toEqual({ type: 'view' });
    // The branch step survived the round trip through the recursive schema.
    const branch = campaign.steps.find((s: any) => s.type === 'branch');
    expect(branch.branch.then.length).toBeGreaterThan(0);
    state.campaignId = campaign.campaignId;
  });

  it('enrols the list into the campaign', async () => {
    const enrolled = await action('campaign.enroll', {
      campaignId: state.campaignId,
      publicIds: ['ada-lovelace', 'grace-hopper'],
    });
    expect(enrolled).toEqual({ enrolled: 2, skipped: 0 });

    const again = await action('campaign.enroll', {
      campaignId: state.campaignId,
      publicIds: ['ada-lovelace'],
    });
    expect(again).toEqual({ enrolled: 0, skipped: 1 });
  });

  it('ticks the campaign and queues rather than sends, because Copilot is the default', async () => {
    const ticked = await action('campaign.tick');
    expect(ticked.queued).toBe(2);

    const pending = await tool('linkedin_queue_list', { status: 'pending' });
    expect(pending.items).toHaveLength(2);
    expect(pending.items[0]).toMatchObject({ action: 'outreach.invite', origin: 'campaign' });
    state.queueId = pending.items[0].id;

    const status = await tool('linkedin_get_status');
    expect(status.queue.pending).toBe(2);
  });

  it('approves one item, and the sent event reaches the webhook receiver', async () => {
    const approved = await tool('linkedin_queue_approve', {
      ids: [state.queueId],
      edits: { [state.queueId!]: { note: 'Edited by a human before sending' } },
    });
    expect(approved).toEqual({ approved: 1 });

    const delivery = await receiver.waitFor('queue_item_sent');
    expect(delivery.payload).toMatchObject({ id: state.queueId, action: 'outreach.invite' });
    expect(typeof delivery.at).toBe('number');

    const sent = await tool('linkedin_queue_list', { status: 'sent' });
    expect(sent.items).toHaveLength(1);
    expect(sent.items[0].params.note).toBe('Edited by a human before sending');
  });

  it('writes the event to the local mirror as well as the webhook', async () => {
    const rows = await tool('linkedin_query_sql', {
      sql: "SELECT event FROM events WHERE event = 'queue_item_sent'",
    });
    expect(rows.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('syncs the extension state into SQLite', async () => {
    const result = await tool('linkedin_sync');
    expect(result.counts.profiles).toBe(2);
    expect(result.counts.lists).toBe(1);
    expect(result.counts.campaigns).toBe(1);
    expect(result.syncedAt).toBeGreaterThan(0);
  });

  it('counts profiles and lists with linkedin_query_sql', async () => {
    const profiles = await tool('linkedin_query_sql', {
      sql: 'SELECT COUNT(*) AS n FROM profiles',
    });
    expect(profiles.rows[0].n).toBe(2);

    const lists = await tool('linkedin_query_sql', {
      sql: 'SELECT name, count FROM lists ORDER BY name',
    });
    expect(lists.rowCount).toBe(1);
    expect(lists.rows[0].name).toBe('Platform leads');

    const members = await tool('linkedin_query_sql', {
      sql: 'SELECT COUNT(*) AS n FROM list_members',
    });
    expect(members.rows[0].n).toBe(2);
  });

  it('refuses a write disguised as a query', async () => {
    const result: any = await mcp.callTool({
      name: 'linkedin_query_sql',
      arguments: { sql: 'DELETE FROM profiles' },
    });
    expect(result.isError).toBe(true);
    const rows = await tool('linkedin_query_sql', { sql: 'SELECT COUNT(*) AS n FROM profiles' });
    expect(rows.rows[0].n).toBe(2);
  });

  it('builds research packs for two rows and completes over the event channel', async () => {
    const packed = await tool('linkedin_research_pack', {
      rows: [
        { name: 'Ada Lovelace', company: 'Difference Engine Ltd' },
        { name: 'Grace Hopper', company: 'Naval Systems' },
      ],
      listName: 'Research',
    });
    expect(packed.status).toBe('completed');
    expect(packed.packs).toHaveLength(2);
    expect(packed.packs[0].resolved.publicId).toBe('ada-lovelace');
    expect(packed.packs[1].markdown).toContain('Grace Hopper');
    state.jobId = packed.jobId;

    const delivery = await receiver.waitFor('research_completed');
    expect(delivery.payload.jobId).toBe(state.jobId);
  });

  it('returns the same packs from linkedin_research_get', async () => {
    const got = await tool('linkedin_research_get', { jobId: state.jobId });
    expect(got.status).toBe('completed');
    expect(got.packs.map((p: any) => p.resolved.publicId)).toEqual([
      'ada-lovelace',
      'grace-hopper',
    ]);
  });

  it('mirrors the packs so they survive the session', async () => {
    const rows = await tool('linkedin_query_sql', { sql: 'SELECT COUNT(*) AS n FROM packs' });
    expect(rows.rows[0].n).toBeGreaterThanOrEqual(2);
  });
});

describe('error paths', () => {
  it('401s an HTTP call carrying the wrong bearer token', async () => {
    const { status, body } = await post(
      '/actions/status.get',
      {},
      { authorization: 'Bearer 0000000000000000000000000000000f', 'content-type': 'application/json' },
    );
    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.howToFix).toBeTruthy();
  });

  it('401s an HTTP call carrying no token at all', async () => {
    const { status, body } = await post('/actions/status.get', {}, { 'content-type': 'application/json' });
    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('400s params the contract rejects, without touching the extension', async () => {
    const before = ext.seen.length;
    const { status, body } = await post('/actions/search.people', { count: 5000 });
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAMS');
    expect(ext.seen.length).toBe(before);
  });

  it('propagates QUOTA_EXCEEDED with retryAfter through HTTP and MCP alike', async () => {
    engine.failNext('outreach.invite', 'QUOTA_EXCEEDED', 'Daily invite cap reached', {
      retryAfter: 3600,
      howToFix: 'Wait for the daily window to reset, or raise the cap in Settings.',
    });
    const { status, body } = await post('/actions/outreach.invite', { publicId: 'ada-lovelace' });
    expect(status).toBe(200); // the HTTP request itself succeeded
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('QUOTA_EXCEEDED');
    expect(body.error.retryAfter).toBe(3600);
    expect(body.error.howToFix).toBeTruthy();

    engine.failNext('outreach.invite', 'QUOTA_EXCEEDED', 'Daily invite cap reached', {
      retryAfter: 3600,
    });
    const result: any = await mcp.callTool({
      name: 'linkedin_send_invite',
      arguments: { publicId: 'ada-lovelace' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      retryAfter: 3600,
    });
  });

  it('reports EXTENSION_OFFLINE once the extension disconnects, and recovers when it returns', async () => {
    await ext.close();
    await new Promise((r) => setTimeout(r, 50));

    const health = await (await fetch(`${base}/health`)).json();
    expect(health.extensionConnected).toBe(false);

    const { status, body } = await post('/actions/status.get', {});
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('EXTENSION_OFFLINE');
    expect(body.error.howToFix).toMatch(/extension/i);

    const result: any = await mcp.callTool({ name: 'linkedin_get_status', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error.code).toBe('EXTENSION_OFFLINE');

    // The local mirror is still readable with no extension attached at all —
    // that is the point of having one.
    const rows = await tool('linkedin_query_sql', { sql: 'SELECT COUNT(*) AS n FROM profiles' });
    expect(rows.rows[0].n).toBe(2);

    ext = new FakeExtension({
      port: toolkit.bridge.port,
      token: TOKEN,
      handlers: engine.handlers(),
    });
    engine.emit = (event, payloadValue) => ext.emit(event, payloadValue);
    await ext.connect();
    await new Promise((r) => setTimeout(r, 50));
    expect((await tool('linkedin_get_status')).loggedIn).toBe(true);
  });

  it('closes a bridge connection that offers the wrong token', async () => {
    const code = await FakeExtension.expectRejected({
      port: toolkit.bridge.port,
      token: 'a'.repeat(32),
    });
    expect(code).toBe(4001);
  });
});
