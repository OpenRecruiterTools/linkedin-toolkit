/**
 * A real HTTP server that speaks the envelope, so the client is tested over an
 * actual socket rather than against a stubbed `fetch`. Everything a test needs
 * to assert — path, headers, body — is recorded.
 */
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

export type RecordedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

export type Responder = (
  request: RecordedRequest,
) => { status?: number; body: unknown } | undefined;

export class MockServer {
  readonly requests: RecordedRequest[] = [];
  private server: Server | null = null;
  private responder: Responder = () => undefined;
  port = 0;

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** The last request, which is what almost every assertion wants. */
  get last(): RecordedRequest {
    const request = this.requests.at(-1);
    if (!request) throw new Error('No request was made.');
    return request;
  }

  respondWith(responder: Responder): void {
    this.responder = responder;
  }

  /** Answer every action with `data`, the common case. */
  respondWithData(data: unknown): void {
    this.responder = () => ({ body: { id: randomUUID(), ok: true, data } });
  }

  /** Answer every action with an error envelope, HTTP 200 as the server does. */
  respondWithError(error: Record<string, unknown>): void {
    this.responder = () => ({ body: { id: randomUUID(), ok: false, error } });
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: unknown = undefined;
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
        }
        const request: RecordedRequest = {
          method: req.method ?? 'GET',
          path: req.url ?? '/',
          headers: req.headers,
          body,
        };
        this.requests.push(request);

        const reply = this.responder(request) ?? {
          status: 200,
          body: { id: randomUUID(), ok: true, data: {} },
        };
        const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
        res.writeHead(reply.status ?? 200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(text),
        });
        res.end(text);
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        this.port = typeof address === 'object' && address ? address.port : 0;
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
}

/** A port nothing is listening on, for the transport-failure tests. */
export async function closedPort(): Promise<number> {
  const server = new MockServer();
  await server.start();
  const { port } = server;
  await server.stop();
  return port;
}
