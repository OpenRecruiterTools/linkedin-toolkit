import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LinkedInToolkit,
  LinkedInToolkitError,
  runOpenAIToolCall,
  toLangChainToolSpecs,
  toLangChainTools,
  toOpenAIAgentsTools,
  toOpenAITools,
  toVercelAITools,
  zodSchemaForTool,
} from '../src/index.js';
import { MockServer } from './mock-server.js';

const server = new MockServer();
let client: LinkedInToolkit;

beforeAll(async () => {
  await server.start();
  client = new LinkedInToolkit({ baseUrl: server.baseUrl, token: 'test-token' });
});
afterAll(() => server.stop());
beforeEach(() => {
  server.requests.length = 0;
  server.respondWithData({ profiles: [] });
});

describe('toOpenAITools', () => {
  it('produces the function-tool shape for all 40 tools', () => {
    const tools = toOpenAITools(client);
    expect(tools).toHaveLength(40);
    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.function.name).toMatch(/^linkedin_/);
      expect(tool.function.description.length).toBeGreaterThan(40);
      expect(tool.function.parameters).toMatchObject({ type: 'object' });
    }
  });

  it('filters to read-only tools, which is how you build an agent that cannot send', () => {
    const tools = toOpenAITools(client, { readOnly: true });
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('linkedin_search_people');
    expect(names).not.toContain('linkedin_send_invite');
    expect(names).not.toContain('linkedin_send_message');
  });

  it('honours include and exclude', () => {
    expect(toOpenAITools(client, { include: ['linkedin_get_status'] }).map((t) => t.function.name)).toEqual([
      'linkedin_get_status',
    ]);
    expect(
      toOpenAITools(client, { exclude: ['linkedin_get_status'] }).map((t) => t.function.name),
    ).not.toContain('linkedin_get_status');
  });
});

describe('runOpenAIToolCall', () => {
  it('runs a Chat Completions tool call', async () => {
    server.respondWithData({ profiles: [{ publicId: 'a' }] });
    const result = await runOpenAIToolCall(client, {
      id: 'call_1',
      type: 'function',
      function: { name: 'linkedin_search_people', arguments: '{"keywords":"CTO","count":5}' },
    });
    expect(server.last.path).toBe('/tools/linkedin_search_people');
    expect(server.last.body).toEqual({ keywords: 'CTO', count: 5 });
    expect(result).toEqual({ profiles: [{ publicId: 'a' }] });
  });

  it('runs a Responses API tool call', async () => {
    await runOpenAIToolCall(client, {
      call_id: 'call_2',
      type: 'function_call',
      name: 'linkedin_get_status',
      arguments: '{}',
    });
    expect(server.last.path).toBe('/tools/linkedin_get_status');
    expect(server.last.body).toEqual({});
  });

  it('treats missing or empty arguments as no arguments', async () => {
    await runOpenAIToolCall(client, { name: 'linkedin_get_status', arguments: null });
    expect(server.last.body).toEqual({});
  });

  it('rejects unparseable arguments without calling the server', async () => {
    const before = server.requests.length;
    const error = (await runOpenAIToolCall(client, {
      function: { name: 'linkedin_search_people', arguments: '{oops' },
    }).catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(error.code).toBe('INVALID_PARAMS');
    expect(server.requests.length).toBe(before);
  });

  it('rejects a call with no name', async () => {
    const error = (await runOpenAIToolCall(client, {
      function: { name: '', arguments: '{}' },
    }).catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(error.code).toBe('INVALID_PARAMS');
  });

  it('propagates an engine error as LinkedInToolkitError', async () => {
    server.respondWithError({ code: 'CHALLENGE_DETECTED', message: 'Clear it in Chrome.' });
    const error = (await runOpenAIToolCall(client, {
      function: { name: 'linkedin_get_status', arguments: '{}' },
    }).catch((e: unknown) => e)) as LinkedInToolkitError;
    expect(error.code).toBe('CHALLENGE_DETECTED');
    expect(error.terminal).toBe(true);
  });
});

describe('toOpenAIAgentsTools', () => {
  it('produces the Agents SDK shape, which is not the Chat Completions one', () => {
    const tools = toOpenAIAgentsTools(client);
    expect(tools).toHaveLength(40);
    const search = tools.find((t) => t.name === 'linkedin_search_people')!;
    expect(search.parameters).toBeInstanceOf(z.ZodObject);
    // Strict mode would require every optional filter to be sent as null.
    expect(search.strict).toBe(false);
    expect(search.description.length).toBeGreaterThan(40);
  });

  it('executes against /tools/{tool}', async () => {
    server.respondWithData({ profiles: [] });
    const tools = toOpenAIAgentsTools(client, { include: ['linkedin_search_people'] });
    await tools[0].execute({ keywords: 'CTO' });
    expect(server.last.path).toBe('/tools/linkedin_search_people');
    expect(server.last.body).toEqual({ keywords: 'CTO' });
  });

  it('takes the same filter as the others', () => {
    const names = toOpenAIAgentsTools(client, { readOnly: true }).map((t) => t.name);
    expect(names).not.toContain('linkedin_send_invite');
  });
});

describe('toVercelAITools', () => {
  it('keys the record by tool name and carries both v4 and v5 schema fields', () => {
    const tools = toVercelAITools(client);
    expect(Object.keys(tools)).toHaveLength(40);
    const search = tools.linkedin_search_people;
    expect(search.description.length).toBeGreaterThan(40);
    expect(search.parameters).toBeInstanceOf(z.ZodObject);
    expect(search.inputSchema).toBe(search.parameters);
  });

  it('validates through the same zod schema the contract defines', () => {
    const tools = toVercelAITools(client);
    expect(tools.linkedin_search_people.parameters.safeParse({ keywords: 'x' }).success).toBe(true);
    expect(tools.linkedin_search_people.parameters.safeParse({}).success).toBe(false);
    expect(tools.linkedin_search_people.parameters.safeParse({ keywords: 'x', count: 500 }).success).toBe(
      false,
    );
  });

  it('executes against /tools/{tool}', async () => {
    server.respondWithData({ status: 'queued', queueId: 'q_9' });
    const tools = toVercelAITools(client);
    const result = await tools.linkedin_send_invite.execute({ publicId: 'someone', dry_run: true });
    expect(server.last.path).toBe('/tools/linkedin_send_invite');
    expect(server.last.body).toEqual({ publicId: 'someone', dry_run: true });
    expect(result).toEqual({ status: 'queued', queueId: 'q_9' });
  });
});

describe('toLangChainToolSpecs', () => {
  it('describes each tool with a zod schema and a string-returning func', async () => {
    const specs = toLangChainToolSpecs(client, { include: ['linkedin_get_status'] });
    expect(specs).toHaveLength(1);
    server.respondWithData({ connected: true });
    const output = await specs[0].func({});
    expect(output).toBe(JSON.stringify({ connected: true }));
    expect(specs[0].schema).toBeInstanceOf(z.ZodObject);
  });
});

describe('toLangChainTools', () => {
  it('builds real DynamicStructuredTool instances that call the server', async () => {
    const tools = (await toLangChainTools(client, {
      include: ['linkedin_search_people'],
    })) as Array<{ name: string; description: string; invoke: (args: unknown) => Promise<string> }>;

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('linkedin_search_people');

    server.respondWithData({ profiles: [{ publicId: 'x' }] });
    const output = await tools[0].invoke({ keywords: 'CTO' });
    expect(server.last.path).toBe('/tools/linkedin_search_people');
    expect(JSON.parse(output)).toEqual({ profiles: [{ publicId: 'x' }] });
  });
});

describe('zodSchemaForTool', () => {
  it('is the contract schema, so JSON Schema and zod cannot drift', () => {
    expect(zodSchemaForTool('linkedin_send_invite').safeParse({ publicId: 'a', dry_run: true }).success).toBe(
      true,
    );
    expect(() => zodSchemaForTool('linkedin_not_a_tool')).toThrow(/Unknown tool/);
  });
});
