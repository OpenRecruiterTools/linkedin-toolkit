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

/**
 * The package binary normally starts an MCP server for an agent.  Let people
 * discover the companion CLI without accidentally starting a long-lived
 * server when they only asked for usage information.
 */
export function isCliInfoRequest(argv: string[]): boolean {
  return argv.some((arg) => ['--help', '-h', '--version', '-V'].includes(arg));
}

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
  const start = isCliInfoRequest(process.argv.slice(2))
    ? async () => {
        const { run } = await import('./cli.js');
        const code = await run(process.argv.slice(2));
        if (code !== 0) process.exit(code);
      }
    : startStdioServer;

  start().catch((err) => {
    process.stderr.write(`linkedin-toolkit-mcp: failed to start: ${String(err)}\n`);
    process.exit(1);
  });
}
