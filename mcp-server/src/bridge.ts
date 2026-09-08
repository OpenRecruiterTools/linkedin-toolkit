/**
 * The localhost WebSocket bridge between this server and the Chrome extension.
 *
 * Protocol (docs/actions.md, "Bridge protocol"):
 *   extension -> server  { type: 'hello', token, extensionVersion }
 *   server -> extension  { type: 'hello_ok', serverVersion }   or close 4001
 *   server -> extension  { id, action, params }
 *   extension -> server  { id, ok: true, data, rateLimit? } | { id, ok: false, error }
 *   extension -> server  { event, payload }
 *
 * Exactly one extension connection is active at a time; a newer hello replaces
 * the older socket.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { ErrorCode, EventName, RequestOrigin } from './contract.js';

export const SERVER_VERSION = '2.0.0';

export const OFFLINE_HOW_TO_FIX =
  'Install the extension from GitHub Releases, open the popup > Settings > Bridge, ' +
  'paste the pairing token printed by `lit serve`, and enable the bridge.';

export class BridgeError extends Error {
  readonly code: ErrorCode;
  readonly retryAfter?: number;
  readonly howToFix?: string;

  constructor(
    code: ErrorCode,
    message: string,
    extra: { retryAfter?: number; howToFix?: string } = {},
  ) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.retryAfter = extra.retryAfter;
    this.howToFix = extra.howToFix;
  }

  toJSON(): { code: ErrorCode; message: string; retryAfter?: number; howToFix?: string } {
    const out: { code: ErrorCode; message: string; retryAfter?: number; howToFix?: string } = {
      code: this.code,
      message: this.message,
    };
    if (this.retryAfter !== undefined) out.retryAfter = this.retryAfter;
    if (this.howToFix !== undefined) out.howToFix = this.howToFix;
    return out;
  }
}

export function offlineError(): BridgeError {
  return new BridgeError(
    'EXTENSION_OFFLINE',
    'The LinkedIn Toolkit Chrome extension is not connected to this server.',
    { howToFix: OFFLINE_HOW_TO_FIX },
  );
}

type Pending = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

export type BridgeOptions = {
  port?: number;
  token: string;
  host?: string;
  pingIntervalMs?: number;
  defaultTimeoutMs?: number;
};

export class BridgeServer extends EventEmitter {
  /** Typed listeners for the three events this server emits. */
  override on(event: 'event', fn: (name: EventName, payload: unknown) => void): this;
  override on(event: 'connected', fn: (info: { extensionVersion: string }) => void): this;
  override on(event: 'disconnected', fn: () => void): this;
  override on(event: string | symbol, fn: (...args: any[]) => void): this;
  override on(event: string | symbol, fn: (...args: any[]) => void): this {
    return super.on(event, fn);
  }

  readonly token: string;
  private readonly host: string;
  private readonly pingIntervalMs: number;
  private readonly defaultTimeoutMs: number;

  private requestedPort: number;
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private pingTimer: NodeJS.Timeout | null = null;
  private extensionVersion: string | null = null;

  constructor(options: BridgeOptions) {
    super();
    this.requestedPort = options.port ?? 47829;
    this.token = options.token;
    this.host = options.host ?? '127.0.0.1';
    this.pingIntervalMs = options.pingIntervalMs ?? 20_000;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
  }

  /** The port actually bound (differs from the requested port when 0 was passed). */
  get port(): number {
    const address = this.wss?.address();
    if (address && typeof address === 'object') return address.port;
    return this.requestedPort;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  connectedExtensionVersion(): string | null {
    return this.isConnected() ? this.extensionVersion : null;
  }

  async start(): Promise<void> {
    if (this.wss) return;
    await new Promise<void>((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.requestedPort, host: this.host });
      const onError = (err: Error) => reject(err);
      wss.once('error', onError);
      wss.once('listening', () => {
        wss.off('error', onError);
        this.wss = wss;
        this.requestedPort = this.port;
        resolve();
      });
      wss.on('connection', (ws) => this.handleConnection(ws));
    });

    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.ping();
    }, this.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.failPending(() => new BridgeError('INTERNAL', 'Bridge server stopped'));
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    const wss = this.wss;
    this.wss = null;
    if (!wss) return;
    await new Promise<void>((resolve) => {
      for (const client of wss.clients) client.terminate();
      wss.close(() => resolve());
    });
  }

  /**
   * Send an action to the extension and wait for its response.
   * Rejects with a BridgeError carrying the contract error code.
   */
  async request(
    action: string,
    params: unknown = {},
    options: { timeoutMs?: number; origin?: RequestOrigin } = {},
  ): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw offlineError();

    const id = randomUUID();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const origin = options.origin;

    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BridgeError(
            'INTERNAL',
            `The extension did not answer ${action} within ${timeoutMs}ms.`,
            { howToFix: 'Check the extension service worker in chrome://extensions and retry.' },
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.send(
          JSON.stringify({ id, action, params: params ?? {}, ...(origin ? { origin } : {}) }),
        );
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new BridgeError('INTERNAL', `Failed to send ${action}: ${String(err)}`));
      }
    });
  }

  /* ---------------------------------------------------------------- */

  private handleConnection(ws: WebSocket): void {
    let helloDone = false;

    ws.on('message', (raw: RawData) => {
      let frame: any;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!helloDone) {
        if (frame?.type !== 'hello') {
          ws.close(4001, 'UNAUTHORIZED');
          return;
        }
        if (frame.token !== this.token) {
          ws.close(4001, 'UNAUTHORIZED');
          return;
        }
        helloDone = true;
        this.extensionVersion = String(frame.extensionVersion ?? 'unknown');
        this.adopt(ws);
        ws.send(JSON.stringify({ type: 'hello_ok', serverVersion: SERVER_VERSION }));
        this.emit('connected', { extensionVersion: this.extensionVersion });
        return;
      }

      this.handleFrame(frame);
    });

    ws.on('close', () => {
      if (this.socket === ws) {
        this.socket = null;
        this.extensionVersion = null;
        // Nothing can answer these any more; failing now beats a 60 s timeout.
        this.failPending(offlineError);
        this.emit('disconnected');
      }
    });

    ws.on('error', () => {
      /* a dead socket is handled by 'close' */
    });
  }

  /** A newer authenticated connection replaces the older one. */
  private adopt(ws: WebSocket): void {
    const previous = this.socket;
    this.socket = ws;
    if (previous && previous !== ws) {
      // Requests in flight belong to the socket being replaced: the extension
      // that is going away will never answer them, and the new one has never
      // seen them. Fail them now rather than letting them time out.
      this.failPending(
        () =>
          new BridgeError(
            'EXTENSION_OFFLINE',
            'The extension reconnected while this request was in flight. Retry it.',
            { howToFix: 'Retry the call; the new extension connection is already live.' },
          ),
      );
      previous.close(1000, 'replaced');
    }
  }

  /** Reject and clear every in-flight request. */
  private failPending(makeError: () => BridgeError): void {
    if (this.pending.size === 0) return;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.reject(makeError());
    }
  }

  private handleFrame(frame: any): void {
    if (typeof frame?.event === 'string') {
      this.emit('event', frame.event as EventName, frame.payload);
      return;
    }
    if (typeof frame?.id !== 'string') return;

    const pending = this.pending.get(frame.id);
    if (!pending) return;
    this.pending.delete(frame.id);
    clearTimeout(pending.timer);

    if (frame.ok === true) {
      pending.resolve(frame.data);
      return;
    }
    const error = frame.error ?? {};
    pending.reject(
      new BridgeError(
        (error.code ?? 'INTERNAL') as ErrorCode,
        String(error.message ?? 'The extension returned an error.'),
        { retryAfter: error.retryAfter, howToFix: error.howToFix },
      ),
    );
  }
}
