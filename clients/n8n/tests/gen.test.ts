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
    expect(ACTIONS).toHaveLength(51);
  });

  it('groups them into the contract namespaces', () => {
    expect(RESOURCES.map((resource) => resource.value).sort()).toEqual(
      [...new Set(ACTIONS.map((action) => action.resource))].sort(),
    );
  });

  it('marks exactly the write actions as writes', () => {
    const writes = ACTIONS.filter((action) => action.write).map((action) => action.action).sort();
    expect(writes).toEqual(
      [
        'campaign.create',
        'campaign.enroll',
        'campaign.pause',
        'campaign.resume',
        'config.set',
        'list.add',
        'list.create',
        'outreach.comment',
        'outreach.follow',
        'outreach.inmail',
        'outreach.invite',
        'outreach.like',
        'outreach.message',
        'outreach.view',
        'queue.approve',
        'queue.reject',
        'research.pack',
      ].sort(),
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
