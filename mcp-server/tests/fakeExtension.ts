/**
 * A stand-in for the Chrome extension: a real WebSocket client that performs the
 * hello handshake, answers requests from a handler map and can emit events.
 * Every test in this package runs against it; nothing here touches LinkedIn.
 */
import { WebSocket } from 'ws';

export type Handler = (params: any) => unknown | Promise<unknown>;
export type Handlers = Record<string, Handler>;

export type FakeExtensionOptions = {
  port: number;
  token: string;
  handlers?: Handlers;
  extensionVersion?: string;
  host?: string;
};

/** Thrown from a handler to make the fake extension answer with an error envelope. */
export class FakeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly extra: { retryAfter?: number; howToFix?: string } = {},
  ) {
    super(message);
    this.name = 'FakeError';
  }
}

export class FakeExtension {
  readonly seen: { action: string; params: any }[] = [];
  private ws: WebSocket | null = null;
  private handlers: Handlers;
  private readonly options: FakeExtensionOptions;
  private helloOk = false;

  constructor(options: FakeExtensionOptions) {
    this.options = options;
    this.handlers = options.handlers ?? {};
  }

  setHandler(action: string, handler: Handler): void {
    this.handlers[action] = handler;
  }

  /** Connect and resolve once the server has answered hello_ok. */
  async connect(): Promise<void> {
    const host = this.options.host ?? '127.0.0.1';
    const ws = new WebSocket(`ws://${host}:${this.options.port}`);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const fail = (err: unknown) => reject(err instanceof Error ? err : new Error(String(err)));
      ws.once('error', fail);
      ws.once('close', (code) => {
        if (!this.helloOk) reject(new Error(`closed before hello_ok: ${code}`));
      });
      ws.once('open', () => {
        ws.send(
          JSON.stringify({
            type: 'hello',
            token: this.options.token,
            extensionVersion: this.options.extensionVersion ?? '2.0.0',
          }),
        );
      });
      ws.on('message', (raw) => {
        let frame: any;
        try {
          frame = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (frame?.type === 'hello_ok') {
          this.helloOk = true;
          ws.off('error', fail);
          resolve();
          return;
        }
        void this.answer(frame);
      });
    });
  }

  /** Connect expecting the server to reject the token; resolves with the close code. */
  static async expectRejected(options: FakeExtensionOptions): Promise<number> {
    const host = options.host ?? '127.0.0.1';
    const ws = new WebSocket(`ws://${host}:${options.port}`);
    return await new Promise<number>((resolve, reject) => {
      ws.once('open', () => {
        ws.send(
          JSON.stringify({
            type: 'hello',
            token: options.token,
            extensionVersion: options.extensionVersion ?? '2.0.0',
          }),
        );
      });
      ws.once('close', (code) => resolve(code));
      ws.once('error', reject);
    });
  }

  emit(event: string, payload: unknown): void {
    this.ws?.send(JSON.stringify({ event, payload }));
  }

  async close(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    if (ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
    });
  }

  private async answer(frame: any): Promise<void> {
    if (typeof frame?.id !== 'string' || typeof frame?.action !== 'string') return;
    this.seen.push({ action: frame.action, params: frame.params });
    const handler = this.handlers[frame.action];
    if (!handler) {
      this.send({
        id: frame.id,
        ok: false,
        error: { code: 'NOT_FOUND', message: `no fake handler for ${frame.action}` },
      });
      return;
    }
    try {
      const data = await handler(frame.params ?? {});
      this.send({ id: frame.id, ok: true, data });
    } catch (err) {
      if (err instanceof FakeError) {
        this.send({
          id: frame.id,
          ok: false,
          error: { code: err.code, message: err.message, ...err.extra },
        });
      } else {
        this.send({
          id: frame.id,
          ok: false,
          error: { code: 'INTERNAL', message: String(err) },
        });
      }
    }
  }

  private send(frame: unknown): void {
    this.ws?.send(JSON.stringify(frame));
  }
}
