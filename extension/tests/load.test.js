/**
 * @vitest-environment jsdom
 *
 * The extension's integration test — as close to "does the service worker come
 * up and answer" as is possible outside Chrome.
 *
 * A real engine-in-Node integration is not possible: the engine is an MV3
 * service worker and needs `chrome.*`, which only Chrome provides. What is
 * possible, and what this file does, is load the real modules against the
 * in-memory `chrome` mock and assert the wiring holds:
 *
 *  - every action in `docs/actions.md` has a handler registered (the doc is the
 *    contract, and it is the same file the MCP server's `contract.test.ts`
 *    checks itself against, so both sides are pinned to one source of truth);
 *  - `status.get` answers with the full Status shape a client needs before it
 *    can do anything;
 *  - `campaign.tick` with nothing enrolled succeeds instead of throwing;
 *  - every module under `src/` imports cleanly, with no import-time exception
 *    and no top-level `chrome.*` call that the mock cannot satisfy.
 *
 * jsdom, rather than the default node environment, because the content scripts
 * and the popup modules touch `document` as they load.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative, sep } from 'node:path';

import { ACTIONS } from '../src/lib/actions.js';
import { registeredActions } from '../src/background/engine.js';
import { route } from '../src/background/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const docPath = resolve(here, '../../docs/actions.md');

/** Every dotted action name in the first column of the action table. */
function documentedActions() {
  const doc = readFileSync(docPath, 'utf8');
  const from = doc.indexOf('### Action names');
  const to = doc.indexOf('### Shared types', from + 1);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  const names = new Set();
  for (const line of doc.slice(from, to).split('\n')) {
    if (!line.startsWith('|')) continue;
    const firstCell = line.split('|')[1] ?? '';
    for (const match of firstCell.matchAll(/`([a-z]+\.[A-Za-z]+)`/g)) names.add(match[1]);
  }
  return [...names];
}

/** Every .js file under src/, as a path relative to src/. */
function everyModule(dir = srcDir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) everyModule(full, found);
    else if (entry.endsWith('.js')) found.push(relative(srcDir, full).split(sep).join('/'));
  }
  return found.sort();
}

const call = async (action, params = {}) => {
  const res = await route({ action, params });
  if (!res.ok) throw new Error(`${action}: ${res.error.code}: ${res.error.message}`);
  return res.data;
};

describe('the service worker registers the documented contract', () => {
  it('has a handler for every action in docs/actions.md', () => {
    const documented = documentedActions();
    expect(documented.length).toBe(53);
    const registered = new Set(registeredActions());
    expect(documented.filter((action) => !registered.has(action))).toEqual([]);
  });

  it('registers nothing the documentation does not describe', () => {
    const documented = new Set(documentedActions());
    expect(registeredActions().filter((action) => !documented.has(action))).toEqual([]);
  });

  it('keeps src/lib/actions.js and the documentation in step', () => {
    expect(Object.values(ACTIONS).sort()).toEqual(documentedActions().sort());
  });

  it('routes every documented action without an unknown-action error', async () => {
    for (const action of documentedActions()) {
      const res = await route({ action, params: {} });
      // Most will fail on missing params or a stubbed network — that is fine.
      // What must never happen is the router not knowing the action at all.
      if (!res.ok) {
        expect(
          res.error.message,
          `${action} was not recognised by the router`,
        ).not.toMatch(/unknown action/i);
      }
    }
  });
});

describe('status.get', () => {
  it('returns the full Status shape', async () => {
    const status = await call('status.get');

    expect(status.connected).toBe(true);
    expect(status.extensionVersion).toBe('2.0.0');
    expect(typeof status.loggedIn).toBe('boolean');
    expect(typeof status.autopilot).toBe('boolean');
    expect(typeof status.businessHours).toBe('boolean');

    expect(Object.keys(status.quotas).sort()).toEqual(['invite', 'message', 'search', 'visit']);
    for (const [kind, quota] of Object.entries(status.quotas)) {
      for (const field of ['hourlyUsed', 'hourlyCap', 'dailyUsed', 'dailyCap', 'nextAllowedAt']) {
        expect(typeof quota[field], `quotas.${kind}.${field}`).toBe('number');
      }
    }

    expect(typeof status.queue.pending).toBe('number');
    expect(typeof status.campaigns.active).toBe('number');
    expect(typeof status.campaigns.paused).toBe('number');
  });

  it('starts in Copilot, which is what makes writes queue for approval', async () => {
    expect((await call('status.get')).autopilot).toBe(false);
  });
});

describe('campaign.tick with nothing enrolled', () => {
  it('succeeds and does nothing', async () => {
    const result = await call('campaign.tick');
    expect(result).toEqual({ executed: 0, queued: 0 });
  });

  it('is still empty on a second tick, and no queue item appeared', async () => {
    await call('campaign.tick');
    expect(await call('campaign.tick')).toEqual({ executed: 0, queued: 0 });
    expect((await call('queue.list', {})).items).toEqual([]);
  });
});

describe('every module under src/ imports cleanly', () => {
  const onDisk = everyModule();
  /** A static glob, so no specifier here is built at runtime. */
  const loaders = import.meta.glob('../src/**/*.js');
  const byName = Object.fromEntries(
    Object.entries(loaders).map(([path, load]) => [path.replace('../src/', ''), load]),
  );

  it('covers exactly the files on disk', () => {
    // A guard against the glob silently matching nothing and this suite
    // passing without importing anything at all.
    expect(onDisk.length).toBeGreaterThan(40);
    expect(Object.keys(byName).sort()).toEqual(onDisk);
    expect(onDisk).toContain('background/index.js');
    expect(onDisk).toContain('content/capture.js');
    expect(onDisk).toContain('popup/popup.js');
  });

  for (const name of onDisk) {
    it(`imports ${name}`, async () => {
      await expect(byName[name]()).resolves.toBeDefined();
    });
  }
});
