/**
 * MCP resources: `linkedin://status`, `linkedin://profile/{publicId}`,
 * `linkedin://list/{listId}` and `linkedin://queue`.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { BridgeError } from './bridge.js';
import type { Toolkit } from './toolkit.js';

const MIME = 'application/json';

function contents(uri: string, data: unknown): ReadResourceResult {
  return { contents: [{ uri, mimeType: MIME, text: JSON.stringify(data, null, 2) }] };
}

function failure(uri: string, err: unknown): ReadResourceResult {
  const error =
    err instanceof BridgeError
      ? err.toJSON()
      : { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
  return { contents: [{ uri, mimeType: MIME, text: JSON.stringify({ error }, null, 2) }] };
}

export function registerResources(server: McpServer, toolkit: Toolkit): void {
  server.registerResource(
    'status',
    'linkedin://status',
    {
      title: 'Toolkit status',
      description:
        'Live connection, login, autopilot, business-hours, quota, approval-queue and campaign status.',
      mimeType: MIME,
    },
    async (uri) => {
      try {
        return contents(uri.href, await toolkit.call('status.get', {}));
      } catch (err) {
        return failure(uri.href, err);
      }
    },
  );

  server.registerResource(
    'queue',
    'linkedin://queue',
    {
      title: 'Approval queue',
      description: 'Writes waiting for human approval in Copilot mode.',
      mimeType: MIME,
    },
    async (uri) => {
      try {
        return contents(uri.href, await toolkit.call('queue.list', { status: 'pending' }));
      } catch (err) {
        return failure(uri.href, err);
      }
    },
  );

  server.registerResource(
    'profile',
    new ResourceTemplate('linkedin://profile/{publicId}', { list: undefined }),
    {
      title: 'LinkedIn profile',
      description: 'One profile by publicId, fetched live through the extension.',
      mimeType: MIME,
    },
    async (uri, variables) => {
      const publicId = String(variables.publicId ?? '');
      try {
        return contents(uri.href, await toolkit.call('profile.get', { publicId }));
      } catch (err) {
        return failure(uri.href, err);
      }
    },
  );

  server.registerResource(
    'list',
    new ResourceTemplate('linkedin://list/{listId}', { list: undefined }),
    {
      title: 'Prospect list',
      description: 'One local list with its members.',
      mimeType: MIME,
    },
    async (uri, variables) => {
      const listId = String(variables.listId ?? '');
      try {
        const [list, members] = await Promise.all([
          toolkit.call('list.get', { listId }),
          toolkit.call('list.members', { listId }),
        ]);
        return contents(uri.href, { ...(list as object), ...(members as object) });
      } catch (err) {
        return failure(uri.href, err);
      }
    },
  );
}
