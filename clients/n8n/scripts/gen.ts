#!/usr/bin/env tsx
/**
 * `npm run gen` — rebuild `nodes/LinkedInToolkit/actions.generated.ts` from
 * `mcp-server/openapi.json`, which the server generates from the contract.
 *
 * The node's resource/operation dropdowns and every field in them come from
 * that file, so an action added to the contract reaches n8n by regenerating
 * rather than by hand-writing another hundred lines of `INodeProperties`.
 * The generated file is committed and `tests/gen.test.ts` fails if it is stale.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(here, '..');
export const repoRoot = resolve(packageRoot, '..', '..');

const OPENAPI_SOURCE = join(repoRoot, 'mcp-server', 'openapi.json');
const TOOLS_SOURCE = join(repoRoot, 'mcp-server', 'tools.json');

/** Words that look wrong when naively title-cased. */
const ACRONYMS: Record<string, string> = {
  Id: 'ID',
  Ids: 'IDs',
  Url: 'URL',
  Urls: 'URLs',
  Csv: 'CSV',
  Sql: 'SQL',
  Ai: 'AI',
  Api: 'API',
  Ms: 'Ms',
  Hq: 'HQ',
};

const RESOURCE_LABELS: Record<string, string> = {
  ai: 'AI',
  status: 'Status',
  config: 'Config',
  search: 'Search',
  profile: 'Profile',
  company: 'Company',
  post: 'Post',
  group: 'Group',
  event: 'Event',
  network: 'Network',
  outreach: 'Outreach',
  inbox: 'Inbox',
  list: 'List',
  campaign: 'Campaign',
  queue: 'Queue',
  export: 'Export',
  research: 'Research',
  sync: 'Sync',
};

export function humanise(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word) => {
      const capitalised = word.charAt(0).toUpperCase() + word.slice(1);
      return ACRONYMS[capitalised] ?? capitalised;
    })
    .join(' ');
}

export function actionKey(action: string): string {
  return action.replace(/\./g, '_');
}

type Schema = Record<string, any>;

/** Follow a local `$ref`. Bounded, because `Step` refers to itself. */
function deref(schema: Schema, document: Schema, depth = 0): Schema {
  let current = schema;
  let level = depth;
  while (current && current.$ref && level < 8) {
    const pointer: string = current.$ref;
    if (!pointer.startsWith('#/')) return {};
    let node: any = document;
    for (const part of pointer.slice(2).split('/')) {
      if (!node || typeof node !== 'object' || !(part in node)) return {};
      node = node[part];
    }
    if (!node || typeof node !== 'object') return {};
    current = node;
    level += 1;
  }
  return current ?? {};
}

export type FieldSpec = {
  /** The n8n parameter name. Prefixed with the action so two operations that
   *  share a field name but not its type can never share a stored value. */
  name: string;
  /** The contract's own parameter name, which is what goes on the wire. */
  key: string;
  displayName: string;
  type: 'string' | 'number' | 'boolean' | 'options' | 'json' | 'stringList';
  required: boolean;
  default: string | number | boolean;
  description: string;
  options?: Array<{ name: string; value: string }>;
};

export type ActionSpec = {
  action: string;
  key: string;
  resource: string;
  operation: string;
  displayName: string;
  description: string;
  write: boolean;
  required: FieldSpec[];
  optional: FieldSpec[];
};

function describe(schema: Schema, name: string): string {
  const parts: string[] = [];
  if (Array.isArray(schema.enum)) parts.push(`One of ${schema.enum.join(', ')}`);
  if (typeof schema.minimum === 'number') parts.push(`minimum ${schema.minimum}`);
  if (typeof schema.maximum === 'number') parts.push(`maximum ${schema.maximum}`);
  return parts.length ? `${parts.join('; ')}.` : `The ${humanise(name)} parameter.`;
}

function field(name: string, raw: Schema, document: Schema, required: boolean, prefix: string): FieldSpec {
  const schema = deref(raw, document);
  const base = {
    name: `${prefix}_${name}`,
    key: name,
    displayName: humanise(name),
    required,
    description: describe(schema, name),
  };

  if (Array.isArray(schema.enum)) {
    return {
      ...base,
      type: 'options',
      default: String(schema.enum[0]),
      options: schema.enum.map((value: unknown) => ({ name: humanise(String(value)), value: String(value) })),
    };
  }

  switch (schema.type) {
    case 'boolean':
      return { ...base, type: 'boolean', default: false };
    case 'integer':
    case 'number':
      return { ...base, type: 'number', default: 0 };
    case 'array': {
      const items = deref(schema.items ?? {}, document);
      if (items.type === 'string') {
        return {
          ...base,
          type: 'stringList',
          default: '',
          description: `${base.description} Comma-separated.`,
        };
      }
      return {
        ...base,
        type: 'json',
        default: '[]',
        description: `${base.description} JSON array.`,
      };
    }
    case 'object':
      return { ...base, type: 'json', default: '{}', description: `${base.description} JSON object.` };
    case 'string':
      return { ...base, type: 'string', default: '' };
    default:
      return { ...base, type: 'json', default: '{}', description: `${base.description} JSON.` };
  }
}

export function buildActions(): { actions: ActionSpec[]; resources: string[] } {
  const document = JSON.parse(readFileSync(OPENAPI_SOURCE, 'utf8')) as Schema;
  const tools = (JSON.parse(readFileSync(TOOLS_SOURCE, 'utf8')) as { tools: any[] }).tools;
  const toolByAction = new Map<string, any>(tools.filter((t) => t.action).map((t) => [t.action, t]));

  const actions: ActionSpec[] = [];
  const resources: string[] = [];

  for (const [path, item] of Object.entries(document.paths as Record<string, Schema>)) {
    if (!path.startsWith('/actions/')) continue;
    const action = path.slice('/actions/'.length);
    const [resource, operation] = action.split('.');
    if (!resources.includes(resource)) resources.push(resource);

    const schema = item.post?.requestBody?.content?.['application/json']?.schema ?? {};
    const properties: Record<string, Schema> = schema.properties ?? {};
    const required = new Set<string>(schema.required ?? []);
    const key = actionKey(action);
    const tool = toolByAction.get(action);
    // `dry_run` follows the server's **write tools**, not the contract's wider
    // `WRITE_ACTIONS`. `config.set`, `list.remove`, `list.delete`,
    // `list.importCsv` and `campaign.delete` are all writes in the contract's
    // sense but none of them sends anything to LinkedIn, so previewing one is
    // meaningless. The 16 tools the server marks `write` are the honest set,
    // and it is the same set both client packages use.
    const write = Boolean(tool?.write);

    const fields = Object.entries(properties).map(([name, spec]) =>
      field(name, spec, document, required.has(name), key),
    );

    if (write) {
      fields.push({
        name: `${key}_dry_run`,
        key: 'dry_run',
        displayName: 'Dry Run',
        type: 'boolean',
        required: false,
        default: false,
        description: 'Preview the write without queueing or sending it.',
      });
    }

    actions.push({
      action,
      key,
      resource,
      operation,
      displayName: humanise(operation),
      description: tool?.description ?? item.post?.description ?? `Run the ${action} action.`,
      write,
      required: fields.filter((f) => f.required),
      optional: fields.filter((f) => !f.required),
    });
  }

  return { actions, resources };
}

const BANNER = [
  '/**',
  ' * AUTO-GENERATED — do not edit by hand.',
  ' *',
  ' * Written by `npm run gen` in `clients/n8n` from `mcp-server/openapi.json`',
  ' * and `mcp-server/tools.json`. Every resource, operation and field in the',
  ' * node comes from here, so the node cannot fall behind the action contract',
  ' * without `tests/gen.test.ts` failing.',
  ' */',
].join('\n');

export function generate(outDir: string = join(packageRoot, 'nodes', 'LinkedInToolkit')): string {
  const { actions, resources } = buildActions();
  const resourceOptions = resources.map((resource) => ({
    name: RESOURCE_LABELS[resource] ?? humanise(resource),
    value: resource,
    description: `${actions.filter((a) => a.resource === resource).length} operation(s).`,
  }));

  const source = [
    BANNER,
    '',
    'export type FieldSpec = {',
    '  name: string;',
    '  key: string;',
    '  displayName: string;',
    "  type: 'string' | 'number' | 'boolean' | 'options' | 'json' | 'stringList';",
    '  required: boolean;',
    '  default: string | number | boolean;',
    '  description: string;',
    '  options?: Array<{ name: string; value: string }>;',
    '};',
    '',
    'export type ActionSpec = {',
    '  action: string;',
    '  key: string;',
    '  resource: string;',
    '  operation: string;',
    '  displayName: string;',
    '  description: string;',
    '  write: boolean;',
    '  required: FieldSpec[];',
    '  optional: FieldSpec[];',
    '};',
    '',
    `export const RESOURCES: Array<{ name: string; value: string; description: string }> = ${JSON.stringify(
      resourceOptions,
      null,
      2,
    )};`,
    '',
    `export const ACTIONS: ActionSpec[] = ${JSON.stringify(actions, null, 2)};`,
    '',
  ].join('\n');

  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, 'actions.generated.ts');
  writeFileSync(target, source, 'utf8');
  return target;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).replace(/\.(ts|js)$/, '') === resolve(here, 'gen').replace(/\.(ts|js)$/, '');

if (invokedDirectly) {
  process.stdout.write(`wrote ${generate()}\n`);
}
