/**
 * The HTTP surface of `lit serve --http`, on 127.0.0.1:47830 by default.
 *
 *   POST /mcp              Model Context Protocol over Streamable HTTP
 *   POST /actions/{action} the action table, one path per action
 *   POST /tools/{tool}     the MCP tools, for non-MCP clients
 *   GET  /openapi.json     generated from the contract
 *   GET  /health           no authentication
 *
 * Everything but /health requires the pairing token as a bearer token, and the
 * listener binds to loopback only.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { BridgeError } from './bridge.js';
import { isAction, PARAMS, toolByName, toolInputSchema, type ActionName } from './contract.js';
import { openApiDocument } from './openapi.js';
import { createMcpServer, runTool, SERVER_VERSION } from './tools.js';
import type { Toolkit } from './toolkit.js';

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export type HttpServerOptions = {
  toolkit: Toolkit;
  port?: number;
  host?: string;
};

function errorEnvelope(err: unknown): { id: string; ok: false; error: Record<string, unknown> } {
  const error =
    err instanceof BridgeError
      ? err.toJSON()
      : { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
  return { id: randomUUID(), ok: false, error };
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (!isLocalOrigin(Array.isArray(origin) ? origin[0] : origin)) return;
  res.setHeader('access-control-allow-origin', String(origin));
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, mcp-session-id');
  res.setHeader('access-control-expose-headers', 'mcp-session-id');
  res.setHeader('vary', 'origin');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new BridgeError('INVALID_PARAMS', 'Request body is not valid JSON.');
  }
}

export class HttpServer {
  private readonly toolkit: Toolkit;
  private readonly host: string;
  private requestedPort: number;
  private server: Server | null = null;

  constructor(options: HttpServerOptions) {
    this.toolkit = options.toolkit;
    this.requestedPort = options.port ?? options.toolkit.config.httpPort;
    this.host = options.host ?? '127.0.0.1';
  }

  get port(): number {
    const address = this.server?.address();
    if (address && typeof address === 'object') return address.port;
    return this.requestedPort;
  }

  get url(): string {
    return `http://${this.host}:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((err) => {
        if (!res.headersSent) sendJson(res, 500, errorEnvelope(err));
        else res.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.requestedPort, this.host, () => {
        server.off('error', reject);
        this.server = server;
        this.requestedPort = this.port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }

  private authorized(req: IncomingMessage): boolean {
    return bearerToken(req) === this.toolkit.config.token;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${this.host}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, {
        ok: true,
        extensionConnected: this.toolkit.isConnected(),
        version: SERVER_VERSION,
      });
      return;
    }

    if (req.method === 'GET' && path === '/openapi.json') {
      sendJson(res, 200, openApiDocument());
      return;
    }

    if (!this.authorized(req)) {
      sendJson(res, 401, {
        id: randomUUID(),
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or wrong bearer token.',
          howToFix: 'Send Authorization: Bearer <token> using the token in ~/.linkedin-toolkit/config.json.',
        },
      });
      return;
    }

    if (path === '/mcp') {
      await this.handleMcp(req, res);
      return;
    }

    if (req.method === 'POST' && path.startsWith('/actions/')) {
      await this.handleAction(req, res, decodeURIComponent(path.slice('/actions/'.length)));
      return;
    }

    if (req.method === 'POST' && path.startsWith('/tools/')) {
      await this.handleTool(req, res, decodeURIComponent(path.slice('/tools/'.length)));
      return;
    }

    sendJson(res, 404, {
      id: randomUUID(),
      ok: false,
      error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${path}.` },
    });
  }

  private async handleAction(
    req: IncomingMessage,
    res: ServerResponse,
    action: string,
  ): Promise<void> {
    if (!isAction(action)) {
      sendJson(res, 404, {
        id: randomUUID(),
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: `Unknown action "${action}".`,
          howToFix: 'GET /openapi.json lists every action this server serves.',
        },
      });
      return;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      sendJson(res, 400, errorEnvelope(err));
      return;
    }

    const parsed = PARAMS[action as ActionName].safeParse(body ?? {});
    if (!parsed.success) {
      sendJson(res, 400, {
        id: randomUUID(),
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: parsed.error.errors.map((e) => `${e.path.join('.') || 'params'}: ${e.message}`).join('; '),
          howToFix: `GET /openapi.json describes the params for ${action}.`,
        },
      });
      return;
    }

    try {
      const data = await this.toolkit.call(action as ActionName, {
        ...(parsed.data as object),
        ...(typeof (body as any)?.dry_run === 'boolean' ? { dry_run: (body as any).dry_run } : {}),
      });
      sendJson(res, 200, { id: randomUUID(), ok: true, data });
    } catch (err) {
      sendJson(res, 200, errorEnvelope(err));
    }
  }

  private async handleTool(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    const tool = toolByName(name);
    if (!tool) {
      sendJson(res, 404, {
        id: randomUUID(),
        ok: false,
        error: { code: 'NOT_FOUND', message: `Unknown tool "${name}".` },
      });
      return;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      sendJson(res, 400, errorEnvelope(err));
      return;
    }

    const parsed = toolInputSchema(tool).safeParse(body ?? {});
    if (!parsed.success) {
      sendJson(res, 400, {
        id: randomUUID(),
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: parsed.error.errors.map((e) => `${e.path.join('.') || 'params'}: ${e.message}`).join('; '),
        },
      });
      return;
    }

    try {
      const data = await runTool(this.toolkit, tool, parsed.data as Record<string, unknown>);
      sendJson(res, 200, { id: randomUUID(), ok: true, data });
    } catch (err) {
      sendJson(res, 200, errorEnvelope(err));
    }
  }

  /**
   * Streamable HTTP MCP, stateless: a fresh server and transport per request so
   * concurrent clients can never collide on request ids.
   */
  private async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      sendJson(res, 405, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Use POST for the Streamable HTTP MCP transport.' },
        id: null,
      });
      return;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      sendJson(res, 400, errorEnvelope(err));
      return;
    }

    const server = createMcpServer(this.toolkit);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}
