import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOpenApi, toolsJson, jsonSchema } from '../src/openapi.js';
import { generate } from '../src/gen.js';
import { ACTIONS, TOOL_NAMES, PARAMS, ERROR_CODES } from '../src/contract.js';

describe('buildOpenApi', () => {
  const doc: any = buildOpenApi();

  it('is an OpenAPI 3.1 document with bearer security', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('LinkedIn Toolkit');
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.servers[0].url).toBe('http://127.0.0.1:47830');
  });

  it('has one path per action', () => {
    for (const action of ACTIONS) {
      expect(doc.paths[`/actions/${action}`]?.post).toBeDefined();
    }
  });

  it('has one path per tool', () => {
    for (const name of TOOL_NAMES) expect(doc.paths[`/tools/${name}`]?.post).toBeDefined();
  });

  it('documents /health and /openapi.json as unauthenticated', () => {
    expect(doc.paths['/health'].get.security).toEqual([]);
    expect(doc.paths['/openapi.json'].get.security).toEqual([]);
  });

  it('lists every error code in the shared Error schema', () => {
    expect(doc.components.schemas.Error.properties.code.enum).toEqual([...ERROR_CODES]);
  });

  it('gives every operation a unique operationId', () => {
    const ids: string[] = [];
    for (const path of Object.values(doc.paths) as any[]) {
      for (const op of Object.values(path) as any[]) ids.push(op.operationId);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shares the type schemas through components and references them', () => {
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(['Profile', 'Company', 'Step', 'Campaign', 'Pack', 'RateLimit']),
    );
    const searchResult =
      doc.paths['/actions/search.people'].post.responses['200'].content['application/json'].schema;
    expect(searchResult.oneOf[0].properties.data.properties.profiles.items).toEqual({
      $ref: '#/components/schemas/Profile',
    });
  });

  it('expresses the recursive campaign Step through a $ref rather than any', () => {
    const step = doc.components.schemas.Step;
    expect(step.properties.branch.properties.then.items).toEqual({
      $ref: '#/components/schemas/Step',
    });
  });

  it('carries the result schema in the 200 response', () => {
    const schema = doc.paths['/actions/network.unfollowCount'].post.responses['200'].content[
      'application/json'
    ].schema;
    expect(schema.oneOf[0].properties.data.properties.count).toEqual({ type: 'number' });
  });
});

describe('jsonSchema', () => {
  it('inlines params and keeps constraints', () => {
    const schema: any = jsonSchema(PARAMS['search.people']);
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['keywords']);
    expect(schema.properties.count.maximum).toBe(100);
    expect(schema.$schema).toBeUndefined();
  });

  it('does not warn about the recursive Step type', () => {
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      jsonSchema(PARAMS['campaign.create']);
    } finally {
      console.warn = warn;
    }
    expect(warnings).toEqual([]);
  });
});

describe('toolsJson', () => {
  const generated = toolsJson();

  it('describes every tool with a JSON-schema input', () => {
    expect(generated.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const tool of generated.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(60);
    }
  });

  it('marks the server-local SQL tool with a null action', () => {
    expect(generated.tools.find((t) => t.name === 'linkedin_query_sql')?.action).toBeNull();
  });
});

describe('npm run gen', () => {
  it('writes openapi.json and tools.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lit-gen-'));
    try {
      const written = generate(dir);
      const openapi = JSON.parse(readFileSync(written.openapi, 'utf8'));
      const tools = JSON.parse(readFileSync(written.tools, 'utf8'));
      expect(openapi.openapi).toBe('3.1.0');
      expect(tools.tools).toHaveLength(TOOL_NAMES.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
