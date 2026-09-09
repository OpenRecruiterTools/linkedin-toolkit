/**
 * The guard that keeps the node honest: the committed action table must be
 * exactly what `npm run gen` produces from the MCP server's OpenAPI document.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generate, humanise, packageRoot, repoRoot } from '../scripts/gen';
import { ACTIONS, RESOURCES } from '../nodes/LinkedInToolkit/actions.generated';

const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('npm run gen', () => {
  it('reproduces the committed action table byte for byte', () => {
    const out = mkdtempSync(join(tmpdir(), 'lit-n8n-gen-'));
    generate(out);
    expect(
      read(join(out, 'actions.generated.ts')),
      'actions.generated.ts is stale — run `npm run gen` in clients/n8n',
    ).toBe(read(join(packageRoot, 'nodes', 'LinkedInToolkit', 'actions.generated.ts')));
  });

  it('covers every action the server serves', () => {
    const openapi = JSON.parse(read(join(repoRoot, 'mcp-server', 'openapi.json'))) as {
      paths: Record<string, unknown>;
    };
    const served = Object.keys(openapi.paths)
      .filter((path) => path.startsWith('/actions/'))
      .map((path) => path.slice('/actions/'.length))
      .sort();
    expect(ACTIONS.map((action) => action.action).sort()).toEqual(served);
    expect(ACTIONS).toHaveLength(53);
  });

  it('groups them into the contract namespaces', () => {
    expect(RESOURCES.map((resource) => resource.value).sort()).toEqual(
      [...new Set(ACTIONS.map((action) => action.resource))].sort(),
    );
  });

  it('offers dry_run on exactly the sixteen tools the server marks as writes', () => {
    const tools = JSON.parse(read(join(repoRoot, 'mcp-server', 'tools.json'))) as {
      tools: Array<{ action: string | null; write: boolean }>;
    };
    const serverWrites = tools.tools
      .filter((tool) => tool.write && tool.action)
      .map((tool) => tool.action as string)
      .sort();

    expect(serverWrites).toHaveLength(16);
    expect(ACTIONS.filter((action) => action.write).map((action) => action.action).sort()).toEqual(
      serverWrites,
    );

    // config.set is a write in the contract's sense but sends nothing to
    // LinkedIn, so previewing it is meaningless — and offering the field would
    // put the node out of step with both client packages.
    const configSet = ACTIONS.find((action) => action.action === 'config.set')!;
    expect([...configSet.required, ...configSet.optional].map((field) => field.key)).not.toContain(
      'dry_run',
    );
  });

  it('humanises names the way the panel should read them', () => {
    expect(humanise('publicId')).toBe('Public ID');
    expect(humanise('publicIds')).toBe('Public IDs');
    expect(humanise('postUrl')).toBe('Post URL');
    expect(humanise('importCsv')).toBe('Import CSV');
    expect(humanise('getAll')).toBe('Get All');
  });
});
