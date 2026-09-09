import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ACTIONS,
  PARAMS,
  RESULTS,
  WRITE_ACTIONS,
  TOOLS,
  TOOL_NAMES,
  ERROR_CODES,
  EVENTS,
  toolInputSchema,
  isAction,
  isWriteAction,
  type ActionName,
} from '../src/contract.js';

const here = dirname(fileURLToPath(import.meta.url));
const docPath = resolve(here, '../../docs/actions.md');
const doc = readFileSync(docPath, 'utf8');

function section(from: string, to: string): string {
  const a = doc.indexOf(from);
  const b = doc.indexOf(to, a + 1);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return doc.slice(a, b);
}

/** Every dotted action name in the first column of the action table. */
function documentedActions(): string[] {
  const table = section('### Action names', '### Shared types');
  const names = new Set<string>();
  for (const line of table.split('\n')) {
    if (!line.startsWith('|')) continue;
    const firstCell = line.split('|')[1] ?? '';
    for (const m of firstCell.matchAll(/`([a-z]+\.[A-Za-z]+)`/g)) names.add(m[1]);
  }
  return [...names];
}

describe('contract vs docs/actions.md', () => {
  it('has a params schema for every documented action', () => {
    const documented = documentedActions();
    expect(documented.length).toBeGreaterThan(40);
    const missing = documented.filter((a) => !isAction(a));
    expect(missing).toEqual([]);
  });

  it('documents every action the contract declares', () => {
    const documented = new Set(documentedActions());
    const extra = ACTIONS.filter((a) => !documented.has(a));
    expect(extra).toEqual([]);
  });

  it('has 53 actions', () => {
    expect(ACTIONS.length).toBe(53);
  });

  it('has a result schema for every action', () => {
    for (const action of ACTIONS) expect(RESULTS[action]).toBeDefined();
  });

  it('mirrors the documented error codes', () => {
    const line = doc.slice(doc.indexOf('Error codes:'));
    for (const code of ERROR_CODES) expect(line).toContain(code);
    expect(ERROR_CODES.length).toBe(13);
  });

  it('mirrors the documented event names', () => {
    const line = doc.slice(doc.indexOf('Event names:'));
    for (const ev of EVENTS) expect(line).toContain(ev);
    expect(EVENTS.length).toBe(13);
  });
});

describe('write actions', () => {
  it('covers outreach, list writes, campaign writes, queue decisions, research.pack and config.set', () => {
    expect([...WRITE_ACTIONS].sort()).toEqual(
      [
        'campaign.create',
        'campaign.delete',
        'campaign.enroll',
        'campaign.pause',
        'campaign.resume',
        'config.set',
        'list.add',
        'list.create',
        'list.delete',
        'list.importCsv',
        'list.remove',
        'outreach.comment',
        'outreach.follow',
        'outreach.invite',
        'outreach.like',
        'outreach.message',
        'outreach.inmail',
        'outreach.view',
        'queue.approve',
        'queue.reject',
        'research.pack',
      ].sort(),
    );
  });

  it('marks no read-only action as a write', () => {
    expect(isWriteAction('search.people')).toBe(false);
    expect(isWriteAction('outreach.invite')).toBe(true);
  });
});

describe('tool mapping', () => {
  it('matches the tool names in docs/actions.md', () => {
    const mapping = section('### MCP tool names', '### HTTP surface');
    const documented = [...mapping.matchAll(/`(linkedin_[a-z_]+)`/g)].map((m) => m[1]);
    expect(new Set(documented)).toEqual(new Set(TOOL_NAMES));
  });

  it('maps each tool to a real action or is server-local', () => {
    for (const tool of TOOLS) {
      if (tool.action === null) {
        expect(tool.name).toBe('linkedin_query_sql');
      } else {
        expect(PARAMS[tool.action]).toBeDefined();
      }
    }
  });

  it('has a one-sentence-or-more description for every tool', () => {
    for (const tool of TOOLS) expect(tool.description.length).toBeGreaterThan(60);
  });

  it('gives write tools a dry_run flag and read tools none', () => {
    for (const tool of TOOLS) {
      const shape = toolInputSchema(tool).shape;
      expect(Object.prototype.hasOwnProperty.call(shape, 'dry_run')).toBe(tool.write);
    }
  });

  it('has unique tool names', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
  });
});

describe('params validation', () => {
  it('caps search.people count at 100', () => {
    expect(PARAMS['search.people'].safeParse({ keywords: 'x', count: 100 }).success).toBe(true);
    expect(PARAMS['search.people'].safeParse({ keywords: 'x', count: 101 }).success).toBe(false);
  });

  it('requires keywords for search.people', () => {
    expect(PARAMS['search.people'].safeParse({}).success).toBe(false);
  });

  it('accepts nested branch steps in campaign.create', () => {
    const parsed = PARAMS['campaign.create'].safeParse({
      name: 'seq',
      steps: [
        { type: 'invite', note: 'hi' },
        {
          type: 'branch',
          branch: { on: 'accepted', then: [{ type: 'message', body: 'yo' }], else: [] },
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown action name', () => {
    expect(isAction('nope.nope' as ActionName)).toBe(false);
  });
});
