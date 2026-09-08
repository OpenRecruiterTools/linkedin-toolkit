import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/tools.js';
import { TOOL_NAMES, TOOLS } from '../src/contract.js';
import { FAKE_RATE_LIMIT } from '../src/fake-extension.js';
import { makeHarness, type Harness } from './helpers.js';
import { defaultHandlers, ada, pack } from './fixtures.js';
import { FakeError } from './fakeExtension.js';

let harness: Harness;
let client: Client;

async function connectClient(h: Harness): Promise<Client> {
  const server = createMcpServer(h.toolkit);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
  return c;
}

/** The JSON payload an agent reads out of a tool result. */
function payload(result: any): any {
  return JSON.parse(result.content[0].text);
}

afterEach(async () => {
  await client?.close();
  await harness?.stop();
});

describe('tool list', () => {
  beforeEach(async () => {
    harness = await makeHarness();
    client = await connectClient(harness);
  });

  it('exposes exactly the tools in the contract mapping', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(39);
  });

  it('gives every tool a description and an object input schema', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description && tool.description.length).toBeGreaterThan(60);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('advertises dry_run on write tools only', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const def = TOOLS.find((t) => t.name === tool.name)!;
      const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect('dry_run' in props).toBe(def.write);
    }
  });

  it('marks read tools readOnlyHint', async () => {
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === 'linkedin_search_people')!;
    const invite = tools.find((t) => t.name === 'linkedin_send_invite')!;
    expect(search.annotations?.readOnlyHint).toBe(true);
    expect(invite.annotations?.readOnlyHint).toBe(false);
  });
});

describe('tool calls through the fake extension', () => {
  beforeEach(async () => {
    harness = await makeHarness();
    client = await connectClient(harness);
  });

  it('returns status as text and structuredContent', async () => {
    const result: any = await client.callTool({ name: 'linkedin_get_status', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(payload(result)).toMatchObject({ loggedIn: true, extensionVersion: '2.0.0' });
    expect(result.structuredContent).toMatchObject({ loggedIn: true });
  });

  it('puts the quota snapshot alongside the data in structuredContent', async () => {
    const result: any = await client.callTool({
      name: 'linkedin_send_invite',
      arguments: { publicId: 'ada-lovelace', note: 'Hi Ada' },
    });
    expect(result.isError).toBeFalsy();
    // The data stays the top-level shape; rateLimit sits beside it.
    expect(result.structuredContent).toMatchObject({ status: 'queued', queueId: 'q_2' });
    expect(result.structuredContent.rateLimit).toEqual(FAKE_RATE_LIMIT);
    expect(payload(result).rateLimit).toBeUndefined();
  });

  it('leaves rateLimit off a read tool the extension sent none with', async () => {
    const result: any = await client.callTool({ name: 'linkedin_get_status', arguments: {} });
    expect(result.structuredContent.rateLimit).toBeUndefined();
  });

  it('passes params through to the extension', async () => {
    await client.callTool({
      name: 'linkedin_search_people',
      arguments: { keywords: 'platform engineer', location: 'London', count: 1 },
    });
    expect(harness.ext.seen.at(-1)).toMatchObject({
      action: 'search.people',
      params: { keywords: 'platform engineer', location: 'London', count: 1 },
    });
  });

  it('marks calls as mcp-originated on the bridge frame', async () => {
    await client.callTool({ name: 'linkedin_get_status', arguments: {} });
    expect(harness.ext.seen.at(-1)?.origin).toBe('mcp');
    await client.callTool({ name: 'linkedin_sync', arguments: {} });
    expect(harness.ext.seen.at(-1)?.origin).toBe('mcp');
  });

  it('mirrors returned profiles into SQLite', async () => {
    await client.callTool({
      name: 'linkedin_search_people',
      arguments: { keywords: 'engineer' },
    });
    expect(harness.toolkit.db.counts().profiles).toBe(2);
  });

  it('forwards dry_run to the extension', async () => {
    const result: any = await client.callTool({
      name: 'linkedin_send_invite',
      arguments: { publicId: ada.publicId, note: 'Hi Ada', dry_run: true },
    });
    expect(payload(result)).toMatchObject({ status: 'dryRun' });
    expect(harness.ext.seen.at(-1)?.params).toMatchObject({ dry_run: true });
  });

  it('reports a queued write in Copilot mode', async () => {
    const result: any = await client.callTool({
      name: 'linkedin_send_message',
      arguments: { publicId: ada.publicId, body: 'hello' },
    });
    expect(payload(result)).toMatchObject({ status: 'queued' });
  });

  it('rejects params that do not match the schema before touching the bridge', async () => {
    const before = harness.ext.seen.length;
    const result: any = await client.callTool({
      name: 'linkedin_search_people',
      arguments: { keywords: 'x', count: 500 },
    });
    expect(result.isError).toBe(true);
    expect(harness.ext.seen.length).toBe(before);
  });

  it('turns an extension error into an isError result with code and howToFix', async () => {
    harness.ext.setHandler('outreach.invite', () => {
      throw new FakeError('QUOTA_EXCEEDED', 'Daily invite cap reached', {
        retryAfter: 3600,
        howToFix: 'Wait until tomorrow or raise nothing — the cap is hard.',
      });
    });
    const result: any = await client.callTool({
      name: 'linkedin_send_invite',
      arguments: { publicId: ada.publicId },
    });
    expect(result.isError).toBe(true);
    expect(payload(result).error).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      retryAfter: 3600,
      howToFix: expect.stringContaining('cap'),
    });
  });
});

describe('offline behaviour', () => {
  beforeEach(async () => {
    harness = await makeHarness({ connect: false });
    client = await connectClient(harness);
  });

  it('answers EXTENSION_OFFLINE with pairing instructions', async () => {
    const result: any = await client.callTool({ name: 'linkedin_get_status', arguments: {} });
    expect(result.isError).toBe(true);
    const { error } = payload(result);
    expect(error.code).toBe('EXTENSION_OFFLINE');
    expect(error.howToFix).toContain('pairing token');
  });

  it('still serves linkedin_query_sql, which is server-local', async () => {
    const result: any = await client.callTool({
      name: 'linkedin_query_sql',
      arguments: { sql: 'SELECT COUNT(*) AS n FROM profiles' },
    });
    expect(result.isError).toBeFalsy();
    expect(payload(result).rows[0].n).toBe(0);
  });
});

describe('linkedin_query_sql', () => {
  beforeEach(async () => {
    harness = await makeHarness();
    client = await connectClient(harness);
  });

  it('queries what previous tool calls mirrored', async () => {
    await client.callTool({ name: 'linkedin_search_people', arguments: { keywords: 'x' } });
    const result: any = await client.callTool({
      name: 'linkedin_query_sql',
      arguments: { sql: 'SELECT full_name FROM profiles ORDER BY public_id' },
    });
    expect(payload(result).rows.map((r: any) => r.full_name)).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
    ]);
  });

  it('refuses to write', async () => {
    const result: any = await client.callTool({
      name: 'linkedin_query_sql',
      arguments: { sql: 'DELETE FROM profiles' },
    });
    expect(result.isError).toBe(true);
    expect(payload(result).error.message).toMatch(/read-only/i);
  });
});

describe('linkedin_sync', () => {
  beforeEach(async () => {
    harness = await makeHarness();
    client = await connectClient(harness);
  });

  it('pulls sync.pull into SQLite and records the sync timestamp', async () => {
    const result: any = await client.callTool({ name: 'linkedin_sync', arguments: {} });
    const data = payload(result);
    expect(data.counts.profiles).toBe(2);
    expect(data.totals.profiles).toBe(2);
    expect(harness.toolkit.db.lastSyncAt).toBeGreaterThan(0);
    expect(harness.ext.seen.at(-1)).toMatchObject({ action: 'sync.pull', params: { since: 0 } });
  });

  it('sends the previous sync timestamp on the second call', async () => {
    await client.callTool({ name: 'linkedin_sync', arguments: {} });
    const first = harness.toolkit.db.lastSyncAt;
    await client.callTool({ name: 'linkedin_sync', arguments: {} });
    expect(harness.ext.seen.at(-1)?.params.since).toBe(first);
  });
});

describe('linkedin_research_pack', () => {
  it('waits for research_completed and returns the packs', async () => {
    const handlers = defaultHandlers();
    handlers['research.pack'] = () => {
      setTimeout(() => harness.ext.emit('research_completed', { jobId: 'job_1' }), 20);
      return { jobId: 'job_1', total: 1, etaMs: 50 };
    };
    harness = await makeHarness({ handlers });
    client = await connectClient(harness);

    const result: any = await client.callTool({
      name: 'linkedin_research_pack',
      arguments: { rows: [{ name: 'Ada Lovelace' }] },
    });
    const data = payload(result);
    expect(data.status).toBe('completed');
    expect(data.packs).toHaveLength(1);
    expect(data.packs[0].markdown).toBe(pack.markdown);
    expect(harness.toolkit.db.counts().packs).toBe(1);
  });

  it('returns the job id to poll when the job outlives the timeout', async () => {
    const handlers = defaultHandlers();
    handlers['research.pack'] = () => ({ jobId: 'job_slow', total: 500, etaMs: 900_000 });
    harness = await makeHarness({ handlers, researchTimeoutMs: 60 });
    client = await connectClient(harness);

    const result: any = await client.callTool({
      name: 'linkedin_research_pack',
      arguments: { rows: [{ name: 'Ada Lovelace' }] },
    });
    const data = payload(result);
    expect(data).toMatchObject({ jobId: 'job_slow', status: 'running', total: 500 });
    expect(data.note).toContain('linkedin_research_get');
  });
});

describe('resources', () => {
  beforeEach(async () => {
    harness = await makeHarness();
    client = await connectClient(harness);
  });

  it('lists the two fixed resources and two templates', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(['linkedin://queue', 'linkedin://status']);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
      'linkedin://list/{listId}',
      'linkedin://profile/{publicId}',
    ]);
  });

  it('reads linkedin://status', async () => {
    const result = await client.readResource({ uri: 'linkedin://status' });
    expect(JSON.parse(result.contents[0].text as string)).toMatchObject({ loggedIn: true });
  });

  it('reads linkedin://queue', async () => {
    const result = await client.readResource({ uri: 'linkedin://queue' });
    const data = JSON.parse(result.contents[0].text as string);
    expect(data.items[0]).toMatchObject({ action: 'outreach.invite', status: 'pending' });
  });

  it('reads a profile by publicId', async () => {
    const result = await client.readResource({ uri: 'linkedin://profile/grace-hopper' });
    expect(JSON.parse(result.contents[0].text as string)).toMatchObject({
      publicId: 'grace-hopper',
    });
  });

  it('reads a list with its members', async () => {
    const result = await client.readResource({ uri: 'linkedin://list/list_1' });
    const data = JSON.parse(result.contents[0].text as string);
    expect(data.listId).toBe('list_1');
    expect(data.members).toHaveLength(1);
  });
});

describe('prompts', () => {
  beforeEach(async () => {
    harness = await makeHarness();
    client = await connectClient(harness);
  });

  it('lists the three contract prompts', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'source-candidates',
      'triage-inbox',
      'write-opener',
    ]);
  });

  it('renders source-candidates with the brief and the tool order', async () => {
    const result = await client.getPrompt({
      name: 'source-candidates',
      arguments: { brief: 'Fractional CTOs in Berlin', count: '10' },
    });
    const text = (result.messages[0].content as any).text as string;
    expect(text).toContain('Fractional CTOs in Berlin');
    expect(text).toContain('Target shortlist size: 10');
    expect(text).toContain('linkedin_search_people');
    expect(text).toContain('linkedin_list_create');
  });

  it('renders write-opener with the publicId and the 300 character rule', async () => {
    const result = await client.getPrompt({
      name: 'write-opener',
      arguments: { publicId: 'ada-lovelace' },
    });
    const text = (result.messages[0].content as any).text as string;
    expect(text).toContain('ada-lovelace');
    expect(text).toContain('300 characters');
    expect(text).toContain('Do not call linkedin_send_invite');
  });

  it('renders triage-inbox', async () => {
    const result = await client.getPrompt({ name: 'triage-inbox', arguments: { since: '24h' } });
    const text = (result.messages[0].content as any).text as string;
    expect(text).toContain('24h');
    expect(text).toContain('linkedin_get_conversations');
  });
});
