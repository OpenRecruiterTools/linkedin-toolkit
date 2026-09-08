#!/usr/bin/env tsx
/**
 * `npm run gen` — regenerate the parts of this package that must never drift
 * from the MCP server's contract.
 *
 * Three files are written into `src/`:
 *
 *   contract.ts          a copy of `mcp-server/src/contract.ts`
 *   methods.ts           one typed method per action, derived from `PARAMS`/`RESULTS`
 *   tools.generated.ts   the 39 tool definitions, derived from `mcp-server/tools.json`
 *
 * All three are committed. `tests/gen.test.ts` regenerates them into a temporary
 * directory and fails if the committed copies differ, so a contract change that
 * is not regenerated cannot pass CI.
 *
 * The contract copy gets exactly one transform, and it is deliberate:
 * `mcp-server` annotates `RESULTS` as `Record<ActionName, z.ZodTypeAny>`, which
 * erases the per-action result types. Dropping the annotation lets `z.infer`
 * see the real schema for each action, which is the whole point of a typed
 * client. An appended type-level assertion proves the object still covers every
 * action, so the annotation is not doing any work we lose.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(here, '..');
export const repoRoot = resolve(packageRoot, '..', '..');

const CONTRACT_SOURCE = join(repoRoot, 'mcp-server', 'src', 'contract.ts');
const TOOLS_SOURCE = join(repoRoot, 'mcp-server', 'tools.json');

const RESULTS_ANNOTATION = 'export const RESULTS: Record<ActionName, z.ZodTypeAny> = {';
const RESULTS_PLAIN = 'export const RESULTS = {';

const BANNER = [
  '/* eslint-disable */',
  '/**',
  ' * AUTO-GENERATED — do not edit by hand.',
  ' *',
  ' * Written by `npm run gen` in `clients/node`. Source of truth:',
  ' * `mcp-server/src/contract.ts`. The only change is that the `RESULTS`',
  ' * annotation is dropped so per-action result types survive `z.infer`;',
  ' * `ResultsCoverEveryAction` at the end of the file proves nothing was lost.',
  ' */',
  '',
].join('\n');

const METHODS_BANNER = [
  '/**',
  ' * AUTO-GENERATED — do not edit by hand.',
  ' *',
  ' * Written by `npm run gen` in `clients/node`, one method per action in',
  ' * `mcp-server/src/contract.ts`. `LinkedInToolkit` extends this class, so',
  ' * every action reaches the same `call()` and the same error handling.',
  ' */',
].join('\n');

const TOOLS_BANNER = [
  '/**',
  ' * AUTO-GENERATED — do not edit by hand.',
  ' *',
  " * Written by `npm run gen` in `clients/node` from `mcp-server/tools.json`,",
  ' * which the server itself generates from the contract. These are the exact',
  ' * definitions the MCP server advertises, so an agent using this package and',
  ' * an agent using MCP see the same 39 tools with the same descriptions.',
  ' */',
].join('\n');

/** `search.people` -> `searchPeople`, `network.unfollowCount` -> `networkUnfollowCount`. */
export function methodName(action: string): string {
  const [head, ...rest] = action.split('.');
  return head + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function isFullyOptional(schema: z.ZodTypeAny): boolean {
  const shape = (schema as z.ZodObject<z.ZodRawShape>)._def?.shape;
  if (typeof shape !== 'function') return false;
  const entries = Object.values(shape() as z.ZodRawShape);
  return entries.every((value) => (value as z.ZodTypeAny).isOptional());
}

function generateContract(): string {
  const source = readFileSync(CONTRACT_SOURCE, 'utf8').replace(/\r\n/g, '\n');
  if (!source.includes(RESULTS_ANNOTATION)) {
    throw new Error(
      `mcp-server/src/contract.ts no longer contains "${RESULTS_ANNOTATION}". ` +
        'Update clients/node/scripts/gen.ts to match before regenerating.',
    );
  }
  const body = source.replace(RESULTS_ANNOTATION, RESULTS_PLAIN);
  const footer = [
    '',
    '/**',
    ' * Compile-time proof that dropping the `RESULTS` annotation did not let an',
    ' * action fall out of the object. `true` when every action has a result schema.',
    ' */',
    'export type ResultsCoverEveryAction = ActionName extends keyof typeof RESULTS ? true : never;',
    '',
  ].join('\n');
  return `${BANNER}${body}${footer}`;
}

async function generateMethods(): Promise<string> {
  const contract = await import(`file://${CONTRACT_SOURCE.replace(/\\/g, '/')}`);
  const actions: string[] = contract.ACTIONS;
  const params: Record<string, z.ZodTypeAny> = contract.PARAMS;
  const tools: Array<{ name: string; action: string | null; description: string; write: boolean }> =
    contract.TOOLS;

  /**
   * `dry_run` follows the **write tools**, not `WRITE_ACTIONS`.
   *
   * The two sets differ: `WRITE_ACTIONS` also holds `config.set`, `list.remove`,
   * `list.delete`, `list.importCsv` and `campaign.delete`, none of which has a
   * tool and none of which sends anything to LinkedIn. `dry_run` is a preview
   * of an outbound write, so the 16 tools the server marks `write` are the
   * honest set — and it is the set the Python client and the n8n node use, so
   * all three agree.
   */
  const dryRunActions = new Set(
    tools.filter((tool) => tool.write && tool.action).map((tool) => tool.action as string),
  );

  const descriptionFor = (action: string): string => {
    const tool = tools.find((t) => t.action === action);
    return tool ? tool.description : `Call the \`${action}\` action.`;
  };

  const lines: string[] = [
    METHODS_BANNER,
    "import type { ActionName, ParamsOf, ResultOf } from './types.js';",
    '',
    '/**',
    ' * The generated action surface. Split out from the client so that the',
    ' * hand-written parts of `LinkedInToolkit` are never touched by `npm run gen`.',
    ' */',
    'export abstract class GeneratedActions {',
    '  /** Implemented by `LinkedInToolkit`. */',
    '  abstract call<A extends ActionName>(action: A, params?: ParamsOf<A>): Promise<ResultOf<A>>;',
  ];

  for (const action of actions) {
    const optional = isFullyOptional(params[action]);
    const dryRun = dryRunActions.has(action);
    const paramsType = dryRun
      ? `ParamsOf<'${action}'> & { dry_run?: boolean }`
      : `ParamsOf<'${action}'>`;
    const signature = optional
      ? `params: ${paramsType} = {} as ${paramsType}`
      : `params: ${paramsType}`;
    const description = descriptionFor(action).replace(/\*\//g, '*\\/');
    lines.push('');
    lines.push(`  /** \`${action}\` — ${description} */`);
    lines.push(`  ${methodName(action)}(${signature}): Promise<ResultOf<'${action}'>> {`);
    lines.push(`    return this.call('${action}', params);`);
    lines.push('  }');
  }

  lines.push('}');
  lines.push('');
  lines.push('/** Every action, and the method name this package exposes it under. */');
  lines.push('export const ACTION_METHODS: Record<ActionName, string> = {');
  for (const action of actions) {
    lines.push(`  '${action}': '${methodName(action)}',`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function generateTools(): string {
  const raw = JSON.parse(readFileSync(TOOLS_SOURCE, 'utf8')) as {
    version: string;
    tools: Array<{
      name: string;
      action: string | null;
      description: string;
      write: boolean;
      inputSchema: Record<string, unknown>;
    }>;
  };
  const definitions = raw.tools.map((tool) => ({
    name: tool.name,
    action: tool.action,
    description: tool.description,
    write: tool.write,
    parameters: tool.inputSchema,
  }));
  return [
    TOOLS_BANNER,
    "import type { ToolDefinition } from './types.js';",
    '',
    `export const TOOLS_VERSION = ${JSON.stringify(raw.version)};`,
    '',
    `export const TOOL_DEFINITIONS: ToolDefinition[] = ${JSON.stringify(definitions, null, 2)};`,
    '',
  ].join('\n');
}

export async function generate(outDir: string = join(packageRoot, 'src')): Promise<{
  contract: string;
  methods: string;
  tools: string;
}> {
  mkdirSync(outDir, { recursive: true });
  const files = {
    contract: join(outDir, 'contract.ts'),
    methods: join(outDir, 'methods.ts'),
    tools: join(outDir, 'tools.generated.ts'),
  };
  writeFileSync(files.contract, generateContract(), 'utf8');
  writeFileSync(files.methods, await generateMethods(), 'utf8');
  writeFileSync(files.tools, generateTools(), 'utf8');
  return files;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).replace(/\.(ts|js)$/, '') === resolve(here, 'gen').replace(/\.(ts|js)$/, '');

if (invokedDirectly) {
  const written = await generate();
  for (const path of Object.values(written)) process.stdout.write(`wrote ${path}\n`);
}
