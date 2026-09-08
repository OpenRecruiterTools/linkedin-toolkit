/**
 * MCP tools. Every entry of `TOOLS` is registered with its zod input schema;
 * results come back both as JSON text and as `structuredContent`, and any
 * bridge failure becomes an `isError` result carrying the contract error shape
 * so an agent can read `code`, `howToFix` and `retryAfter`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BridgeError } from './bridge.js';
import { TOOLS, toolInputSchema, type ActionName, type ToolDef } from './contract.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import type { Toolkit } from './toolkit.js';

export const SERVER_NAME = 'linkedin-toolkit';
export const SERVER_VERSION = '2.0.0';

/** A tool result: the JSON text an agent reads plus machine-readable output. */
export function toolResult(data: unknown): CallToolResult {
  const structured =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { result: data };
  return {
    content: [{ type: 'text', text: JSON.stringify(data ?? null) }],
    structuredContent: structured,
  };
}

/** An error result an agent can act on without parsing prose. */
export function toolError(err: unknown): CallToolResult {
  const error =
    err instanceof BridgeError
      ? err.toJSON()
      : { code: 'INTERNAL' as const, message: err instanceof Error ? err.message : String(err) };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error }) }],
    structuredContent: { error },
  };
}

/** Run one tool by name against the toolkit. Shared by MCP and the CLI tests. */
export async function runTool(
  toolkit: Toolkit,
  tool: ToolDef,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (tool.name) {
    case 'linkedin_query_sql': {
      const sql = String(args.sql ?? '');
      const params = (args.params ?? []) as (string | number | null)[];
      return toolkit.db.query(sql, params);
    }
    case 'linkedin_sync': {
      const since = typeof args.since === 'number' ? args.since : undefined;
      return await toolkit.sync(since);
    }
    case 'linkedin_research_pack':
      return await toolkit.researchPack(args);
    default:
      return await toolkit.call(tool.action as ActionName, args);
  }
}

export function registerTools(server: McpServer, toolkit: Toolkit): void {
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: toolInputSchema(tool).shape,
        annotations: {
          readOnlyHint: !tool.write,
          destructiveHint: false,
          openWorldHint: tool.action !== null,
        },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          return toolResult(await runTool(toolkit, tool, args ?? {}));
        } catch (err) {
          return toolError(err);
        }
      },
    );
  }
}

/** The MCP server used by both the stdio entry point and the HTTP transport. */
export function createMcpServer(toolkit: Toolkit): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'LinkedIn Toolkit drives the user\'s own logged-in Chrome through a local extension. ' +
        'Call linkedin_get_status first. Reads (search, profile, company, engagers, inbox) are safe; ' +
        'writes (invite, message, inmail, like, comment) are rate-capped by the extension and, in the ' +
        'default Copilot mode, queue for human approval instead of sending. Pass dry_run to preview a ' +
        'write. Use linkedin_sync then linkedin_query_sql to work over past captures instead of ' +
        're-scraping.',
    },
  );
  registerTools(server, toolkit);
  registerResources(server, toolkit);
  registerPrompts(server, toolkit);
  return server;
}
