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

/** `--help`, but not `--version`: only help gets the explanatory preamble. */
export function isHelpRequest(argv: string[]): boolean {
  return argv.some((arg) => ['--help', '-h'].includes(arg));
}

/**
 * What `npx linkedin-toolkit-mcp --help` prints above the `lit` usage.
 *
 * Someone who reaches this binary from a client's MCP settings, a registry
 * listing or `npx` has usually never seen the extension, so the usage alone
 * ("Usage: lit ...") answers a question they did not ask. These lines say what
 * the binary is, how to wire it in, and where the pairing token is.
 */
export const HELP_INTRO = [
  'linkedin-toolkit-mcp is a stdio MCP server. It carries no LinkedIn code itself: it pairs',
  'with the LinkedIn Toolkit Chrome extension over a localhost WebSocket and drives your own',
  'logged-in session — no headless browser, no hosted service, no account of ours.',
  '',
  'Wire it into an MCP client with:',
  '  {"command": "npx", "args": ["-y", "linkedin-toolkit-mcp"]}',
  '',
  'The pairing token is printed on first start and stored in ~/.linkedin-toolkit/config.json;',
  'read it back with `lit config get token --reveal` and paste it into the extension popup.',
  'Run `lit serve --http` instead for the HTTP action API and MCP over Streamable HTTP.',
  '',
  'The rest of this help is the bundled `lit` CLI, which ships in the same package:',
  '',
].join('\n');

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
  const argv = process.argv.slice(2);
  const start = isCliInfoRequest(argv)
    ? async () => {
        if (isHelpRequest(argv)) process.stdout.write(`${HELP_INTRO}\n`);
        const { run } = await import('./cli.js');
        const code = await run(argv);
        if (code !== 0) process.exit(code);
      }
    : startStdioServer;

  start().catch((err) => {
    process.stderr.write(`linkedin-toolkit-mcp: failed to start: ${String(err)}\n`);
    process.exit(1);
  });
}
