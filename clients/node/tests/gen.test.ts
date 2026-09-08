/**
 * The guard that keeps this package honest: the committed generated files must
 * be exactly what `npm run gen` produces from the MCP server's contract right
 * now. A contract change that is not regenerated fails here rather than
 * surfacing as a silently wrong tool schema six months later.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, methodName, packageRoot, repoRoot } from '../scripts/gen.js';
import { ACTIONS, TOOL_NAMES } from '../src/contract.js';
import { ACTION_METHODS } from '../src/methods.js';
import { TOOL_DEFINITIONS, TOOLS_VERSION } from '../src/tools.generated.js';

const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('npm run gen', () => {
  it('reproduces the committed generated files byte for byte', async () => {
    const out = mkdtempSync(join(tmpdir(), 'lit-gen-'));
    await generate(out);

    for (const file of ['contract.ts', 'methods.ts', 'tools.generated.ts']) {
      expect(read(join(out, file)), `${file} is stale — run \`npm run gen\` in clients/node`).toBe(
        read(join(packageRoot, 'src', file)),
      );
    }
  });

  it('copies the contract from the MCP server with only the documented transform', () => {
    const source = read(join(repoRoot, 'mcp-server', 'src', 'contract.ts'));
    const copy = read(join(packageRoot, 'src', 'contract.ts'));

    expect(copy).toContain(source.replace('export const RESULTS: Record<ActionName, z.ZodTypeAny> = {', 'export const RESULTS = {'));
    expect(copy).toContain('AUTO-GENERATED');
    expect(copy).toContain('ResultsCoverEveryAction');
  });

  it('names methods the way the client documents', () => {
    expect(methodName('status.get')).toBe('statusGet');
    expect(methodName('search.people')).toBe('searchPeople');
    expect(methodName('network.unfollowCount')).toBe('networkUnfollowCount');
  });
});

describe('generated tool definitions', () => {
  it('match mcp-server/tools.json exactly', () => {
    const source = JSON.parse(read(join(repoRoot, 'mcp-server', 'tools.json'))) as {
      version: string;
      tools: Array<Record<string, unknown>>;
    };
    expect(TOOLS_VERSION).toBe(source.version);
    expect(TOOL_DEFINITIONS).toHaveLength(source.tools.length);
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual(source.tools.map((t) => t.name));
    for (const [index, tool] of TOOL_DEFINITIONS.entries()) {
      expect(tool.parameters).toEqual(source.tools[index].inputSchema);
      expect(tool.description).toBe(source.tools[index].description);
      expect(tool.write).toBe(source.tools[index].write);
    }
  });

  it('covers every tool the contract declares', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  it('leaves linkedin_query_sql as the only tool with no action behind it', () => {
    // linkedin_sync and linkedin_research_pack are server-local in behaviour but
    // each still names the action it drives; only the SQL tool has none.
    const local = TOOL_DEFINITIONS.filter((t) => t.action === null).map((t) => t.name);
    expect(local).toEqual(['linkedin_query_sql']);
    for (const tool of TOOL_DEFINITIONS) {
      if (tool.action !== null) expect(ACTIONS).toContain(tool.action);
    }
  });
});

describe('dry_run parity with the server', () => {
  const serverWriteTools = (): { names: string[]; actions: string[] } => {
    const source = JSON.parse(read(join(repoRoot, 'mcp-server', 'tools.json'))) as {
      tools: Array<{ name: string; action: string | null; write: boolean }>;
    };
    const writes = source.tools.filter((tool) => tool.write);
    return {
      names: writes.map((tool) => tool.name).sort(),
      actions: writes.map((tool) => tool.action as string).sort(),
    };
  };

  /** The generated method signature for one action, up to its return type. */
  const signatureFor = (methods: string, action: string): string => {
    const marker = `(params: ParamsOf<'${action}'>`;
    const start = methods.indexOf(marker);
    if (start === -1) throw new Error(`No generated method for ${action}.`);
    const end = methods.indexOf('): Promise', start);
    return methods.slice(start, end);
  };

  it('offers dry_run on exactly the sixteen tools the server marks as writes', () => {
    const { names } = serverWriteTools();
    expect(names).toHaveLength(16);

    const offered = TOOL_DEFINITIONS.filter(
      (tool) => (tool.parameters.properties as Record<string, unknown>)?.dry_run !== undefined,
    )
      .map((tool) => tool.name)
      .sort();
    expect(offered).toEqual(names);
  });

  it('offers dry_run on exactly the matching typed methods, and nowhere else', () => {
    const { actions } = serverWriteTools();
    const methods = read(join(packageRoot, 'src', 'methods.ts'));

    const offered = ACTIONS.filter((action) => signatureFor(methods, action).includes('dry_run')).sort();
    expect(offered).toEqual(actions);
    expect(Object.keys(ACTION_METHODS)).toHaveLength(51);
  });

  it('does not offer dry_run on the writes that never reach LinkedIn', () => {
    // These five are in the contract's WRITE_ACTIONS but none of them sends
    // anything to LinkedIn, so previewing one is meaningless — and offering the
    // field would put this client out of step with the Python one and the node.
    const methods = read(join(packageRoot, 'src', 'methods.ts'));
    for (const action of ['config.set', 'list.remove', 'list.delete', 'list.importCsv', 'campaign.delete']) {
      expect(signatureFor(methods, action), action).not.toContain('dry_run');
    }
  });
});
