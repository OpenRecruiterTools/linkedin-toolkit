import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BridgeServer, BridgeError, offlineError } from '../src/bridge.js';
import { FakeExtension, FakeError } from './fakeExtension.js';
import { defaultHandlers, ada } from './fixtures.js';

const TOKEN = 'a'.repeat(32);

describe('BridgeServer', () => {
  let bridge: BridgeServer;
  let ext: FakeExtension | null = null;

  beforeEach(async () => {
    bridge = new BridgeServer({ port: 0, token: TOKEN, pingIntervalMs: 50 });
    await bridge.start();
  });

  afterEach(async () => {
    await ext?.close();
    ext = null;
    await bridge.stop();
  });

  it('binds an ephemeral port and reports itself disconnected', () => {
    expect(bridge.port).toBeGreaterThan(0);
    expect(bridge.isConnected()).toBe(false);
  });

  it('throws EXTENSION_OFFLINE with howToFix when nothing is connected', async () => {
    await expect(bridge.request('status.get')).rejects.toMatchObject({
      code: 'EXTENSION_OFFLINE',
    });
    const err = offlineError();
    expect(err.howToFix).toContain('pairing token');
    expect(err.toJSON()).toMatchObject({ code: 'EXTENSION_OFFLINE' });
  });

  it('completes the hello handshake and answers a request', async () => {
    ext = new FakeExtension({ port: bridge.port, token: TOKEN, handlers: defaultHandlers() });
    await ext.connect();
    expect(bridge.isConnected()).toBe(true);
    expect(bridge.connectedExtensionVersion()).toBe('2.0.0');

    const profile = await bridge.request('profile.get', { publicId: 'ada-lovelace' });
    expect(profile).toMatchObject({ publicId: ada.publicId, fullName: 'Ada Lovelace' });
    expect(ext.seen[0]).toEqual({
      action: 'profile.get',
      params: { publicId: 'ada-lovelace' },
    });
  });

  it('closes with 4001 on a token mismatch', async () => {
    const code = await FakeExtension.expectRejected({ port: bridge.port, token: 'wrong' });
    expect(code).toBe(4001);
    expect(bridge.isConnected()).toBe(false);
  });

  it('closes with 4001 when the first frame is not a hello', async () => {
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    const code = await new Promise<number>((resolve) => {
      ws.once('open', () => ws.send(JSON.stringify({ id: '1', ok: true, data: {} })));
      ws.once('close', (c) => resolve(c));
    });
    expect(code).toBe(4001);
  });

  it('turns an error envelope into a BridgeError with retryAfter and howToFix', async () => {
    const handlers = defaultHandlers();
    handlers['outreach.invite'] = () => {
      throw new FakeError('RATE_LIMITED', 'Hourly invite cap reached', {
        retryAfter: 3600,
        howToFix: 'Wait for the hourly window to reset.',
      });
    };
    ext = new FakeExtension({ port: bridge.port, token: TOKEN, handlers });
    await ext.connect();

    await expect(bridge.request('outreach.invite', { publicId: 'x' })).rejects.toMatchObject({
      name: 'BridgeError',
      code: 'RATE_LIMITED',
      retryAfter: 3600,
      howToFix: 'Wait for the hourly window to reset.',
    });
  });

  it('times out a request the extension never answers', async () => {
    ext = new FakeExtension({
      port: bridge.port,
      token: TOKEN,
      handlers: { 'status.get': () => new Promise(() => {}) },
    });
    await ext.connect();
    await expect(bridge.request('status.get', {}, { timeoutMs: 60 })).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('forwards extension events to on("event")', async () => {
    ext = new FakeExtension({ port: bridge.port, token: TOKEN, handlers: defaultHandlers() });
    await ext.connect();

    const received = new Promise<{ name: string; payload: unknown }>((resolve) => {
      bridge.on('event', (name, payload) => resolve({ name, payload }));
    });
    ext.emit('reply_received', { threadId: 'thread_1' });
    await expect(received).resolves.toEqual({
      name: 'reply_received',
      payload: { threadId: 'thread_1' },
    });
  });

  it('replaces an older connection with a newer one', async () => {
    const first = new FakeExtension({ port: bridge.port, token: TOKEN, handlers: defaultHandlers() });
    await first.connect();
    ext = new FakeExtension({
      port: bridge.port,
      token: TOKEN,
      handlers: defaultHandlers(),
      extensionVersion: '2.0.1',
    });
    await ext.connect();

    await new Promise((r) => setTimeout(r, 30));
    expect(bridge.isConnected()).toBe(true);
    expect(bridge.connectedExtensionVersion()).toBe('2.0.1');
    const data = await bridge.request('status.get');
    expect(data).toMatchObject({ loggedIn: true });
    await first.close();
  });

  it('fails an in-flight request the moment the extension disconnects', async () => {
    ext = new FakeExtension({
      port: bridge.port,
      token: TOKEN,
      // Accepts the request and never answers it.
      handlers: { 'search.people': () => new Promise(() => {}) },
    });
    await ext.connect();

    // The default 60 s timeout must not be what ends this. The rejection is
    // captured up front so it is never briefly unhandled.
    const inFlight = bridge.request('search.people', { keywords: 'x' }).catch((err) => err);
    const startedAt = Date.now();
    await new Promise((r) => setTimeout(r, 20));
    await ext.close();
    ext = null;

    expect(await inFlight).toMatchObject({ code: 'EXTENSION_OFFLINE' });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('fails an in-flight request when a newer extension replaces the old one', async () => {
    const first = new FakeExtension({
      port: bridge.port,
      token: TOKEN,
      handlers: { 'search.people': () => new Promise(() => {}) },
    });
    await first.connect();

    const inFlight = bridge.request('search.people', { keywords: 'x' }).catch((err) => err);
    await new Promise((r) => setTimeout(r, 20));

    ext = new FakeExtension({ port: bridge.port, token: TOKEN, handlers: defaultHandlers() });
    await ext.connect();

    expect(await inFlight).toMatchObject({
      code: 'EXTENSION_OFFLINE',
      message: expect.stringContaining('reconnected'),
    });
    // The replacement connection is immediately usable.
    await expect(bridge.request('status.get')).resolves.toMatchObject({ loggedIn: true });
    await first.close();
  });

  it('sends the optional origin field only when one is given', async () => {
    ext = new FakeExtension({ port: bridge.port, token: TOKEN, handlers: defaultHandlers() });
    await ext.connect();

    await bridge.request('status.get', {}, { origin: 'cli' });
    expect(ext.seen.at(-1)?.origin).toBe('cli');

    await bridge.request('status.get', {});
    expect(ext.seen.at(-1)?.origin).toBeUndefined();
  });

  it('goes offline again when the extension disconnects', async () => {
    ext = new FakeExtension({ port: bridge.port, token: TOKEN, handlers: defaultHandlers() });
    await ext.connect();
    const gone = new Promise<void>((resolve) => bridge.on('disconnected', () => resolve()));
    await ext.close();
    ext = null;
    await gone;
    expect(bridge.isConnected()).toBe(false);
    await expect(bridge.request('status.get')).rejects.toBeInstanceOf(BridgeError);
  });

  it('tolerates a pong frame without treating it as a response or an event', async () => {
    ext = new FakeExtension({ port: bridge.port, token: TOKEN, handlers: defaultHandlers() });
    await ext.connect();

    const events: string[] = [];
    bridge.on('event', (name) => events.push(name));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ext.sendRaw({ type: 'pong' });
    await new Promise((r) => setTimeout(r, 20));

    expect(events).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    // The socket is still perfectly usable.
    await expect(bridge.request('status.get')).resolves.toMatchObject({ loggedIn: true });

    errors.mockRestore();
    warnings.mockRestore();
  });
});

/**
 * The JSON keepalive is not the same thing as the protocol ping. A browser
 * answers a protocol ping without ever waking the extension's service worker,
 * which Chrome then kills after ~30 s — holding an open socket. A `{type:
 * 'ping'}` message is JavaScript the worker has to run.
 */
describe('BridgeServer keepalive', () => {
  it('sends a JSON ping within the interval, alongside the protocol ping', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const server = new BridgeServer({ port: 0, token: TOKEN, pingIntervalMs: 20_000 });
    let client: FakeExtension | null = null;

    try {
      await server.start();
      client = new FakeExtension({ port: server.port, token: TOKEN, handlers: defaultHandlers() });
      await client.connect();
      expect(client.pings).toBe(0);

      vi.advanceTimersByTime(20_000);
      // Delivery is real socket I/O, so wait for it on the real clock.
      const deadline = Date.now() + 2000;
      while (client.pings === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }

      expect(client.pings).toBeGreaterThanOrEqual(1);
      // The pong it answered with did not break the connection.
      expect(server.isConnected()).toBe(true);
      await expect(server.request('status.get')).resolves.toMatchObject({ loggedIn: true });
    } finally {
      vi.useRealTimers();
      await client?.close();
      await server.stop();
    }
  });
});
