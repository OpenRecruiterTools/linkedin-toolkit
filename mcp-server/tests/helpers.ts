/** Wiring shared by the MCP, HTTP and CLI tests. Everything runs offline. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Toolkit } from '../src/toolkit.js';
import { Db } from '../src/db.js';
import { Webhooks } from '../src/webhooks.js';
import type { ServerConfig } from '../src/config.js';
import { FakeExtension, type Handlers } from './fakeExtension.js';
import { defaultHandlers } from './fixtures.js';

export const TEST_TOKEN = 'f'.repeat(32);

export type Harness = {
  toolkit: Toolkit;
  ext: FakeExtension;
  dir: string;
  config: ServerConfig;
  stop: () => Promise<void>;
};

export async function makeHarness(
  options: { handlers?: Handlers; connect?: boolean; researchTimeoutMs?: number } = {},
): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'lit-test-'));
  const config: ServerConfig = {
    token: TEST_TOKEN,
    bridgePort: 0,
    httpPort: 0,
    dbPath: join(dir, 'toolkit.db'),
    researchTimeoutMs: options.researchTimeoutMs ?? 2000,
  };
  const toolkit = new Toolkit({
    config,
    db: new Db(config.dbPath),
    webhooks: new Webhooks(),
    bridgeOptions: { port: 0, pingIntervalMs: 1000 },
  });
  await toolkit.start();

  const ext = new FakeExtension({
    port: toolkit.bridge.port,
    token: TEST_TOKEN,
    handlers: options.handlers ?? defaultHandlers(),
  });
  if (options.connect !== false) await ext.connect();

  return {
    toolkit,
    ext,
    dir,
    config,
    stop: async () => {
      await ext.close();
      await toolkit.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A port on loopback that nothing is listening on.
 *
 * Tests for "the server is not running" must not simply use the default 47830:
 * a developer running `lit serve --http` on their own machine listens there, so
 * the request reaches a real server and is refused for the token instead of the
 * connection, and the test fails for a reason that has nothing to do with what
 * it is checking. Binding and immediately releasing a port gives one the kernel
 * has just confirmed is free.
 */
export async function closedPort(): Promise<number> {
  const { createServer } = await import('node:http');
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
