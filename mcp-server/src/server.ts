#!/usr/bin/env node
/**
 * stdio entry point: the binary an MCP client (Claude Code, Claude Desktop,
 * Cursor, …) launches. Starts the bridge, then speaks MCP over stdio.
 *
 * Nothing may be written to stdout here except MCP frames, so all logging goes
 * to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { Toolkit } from './toolkit.js';
import { createMcpServer } from './tools.js';

export async function startStdioServer(): Promise<Toolkit> {
  const { config } = loadConfig();
  const toolkit = new Toolkit({ config });
  await toolkit.start();

  process.stderr.write(
    `linkedin-toolkit-mcp: bridge listening on ws://127.0.0.1:${toolkit.bridge.port}\n` +
      `linkedin-toolkit-mcp: pairing token ${config.token}\n`,
  );

  const server = createMcpServer(toolkit);
  await server.connect(new StdioServerTransport());

  const shutdown = () => {
    void toolkit.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return toolkit;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href ||
    process.argv[1].endsWith('server.js')
  : false;

if (invokedDirectly) {
  startStdioServer().catch((err) => {
    process.stderr.write(`linkedin-toolkit-mcp: failed to start: ${String(err)}\n`);
    process.exit(1);
  });
}
