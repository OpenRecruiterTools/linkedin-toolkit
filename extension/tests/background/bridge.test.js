import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS, EVENTS } from '../../src/lib/actions.js';
import { register, resetEngine } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as bridge from '../../src/background/bridge.js';
import * as events from '../../src/background/events.js';

/** A WebSocket stand-in: nothing opens until the test says so. */
class FakeSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = 0;
    FakeSocket.instances.push(this);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close(code) {
    this.readyState = 3;
    if (this.onclose) this.onclose({ code: code || 1000 });
  }

  /* --- test drivers --- */
  open() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }

  deliver(frame) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(frame) });
  }

  serverClose(code) {
    this.readyState = 3;
    if (this.onclose) this.onclose({ code });
  }

  get frames() {
    return this.sent;
  }
}

let timers;

const socket = () => FakeSocket.instances[FakeSocket.instances.length - 1];

/** Run the pending retry callbacks. */
async function fireTimers() {
  const due = [...timers];
  timers.length = 0;
  for (const t of due) await t.fn();
}

beforeEach(async () => {
  FakeSocket.instances = [];
  timers = [];
  bridge.disconnect();
  bridge.setWebSocketFactory(FakeSocket);
  bridge.setTimerFn((fn, ms) => timers.push({ fn, ms }));
  await setConfig({ bridge: { enabled: true, port: 47829, token: 'pair-token' } });
});

afterEach(() => {
  bridge.disconnect();
  bridge.setWebSocketFactory(null);
  bridge.setTimerFn(null);
});

/** Connect and complete the handshake. */
async function connect() {
  await bridge.ensureConnected();
  socket().open();
  socket().deliver({ type: 'hello_ok', serverVersion: '2.0.0' });
  await Promise.resolve();
}

describe('handshake', () => {
  it('dials 127.0.0.1 on the configured port and says hello', async () => {
    await bridge.ensureConnected();
    expect(socket().url).toBe('ws://127.0.0.1:47829');

    socket().open();
    expect(socket().frames[0]).toEqual({
      type: 'hello',
      token: 'pair-token',
      extensionVersion: '2.0.0',
    });
    expect(bridge.isConnected()).toBe(false);
  });

  it('is connected once hello_ok arrives', async () => {
    await connect();
    expect(bridge.isConnected()).toBe(true);
    expect(bridge.bridgeState().serverVersion).toBe('2.0.0');
    expect(bridge.bridgeState().attempts).toBe(0);
  });

  it('does nothing at all while the bridge is disabled', async () => {
    await setConfig({ bridge: { enabled: false } });
    expect(await bridge.ensureConnected()).toEqual({ connected: false, reason: 'disabled' });
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('does not open a second socket when already connected', async () => {
    await connect();
    await bridge.ensureConnected();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe('close 4001', () => {
  it('marks the bridge unauthorized and stops retrying', async () => {
    await bridge.ensureConnected();
    socket().open();
    socket().serverClose(4001);

    expect(bridge.isConnected()).toBe(false);
    expect(bridge.bridgeState().unauthorized).toBe(true);
    expect(bridge.bridgeState().lastError).toMatch(/UNAUTHORIZED/);
    expect(timers).toHaveLength(0);

    expect(await bridge.ensureConnected()).toEqual({ connected: false, reason: 'unauthorized' });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('tries again once the token changes', async () => {
    await bridge.ensureConnected();
    socket().open();
    socket().serverClose(4001);

    await setConfig({ bridge: { enabled: true, port: 47829, token: 'new-token' } });
    await bridge.ensureConnected();
    expect(FakeSocket.instances).toHaveLength(2);
    socket().open();
    expect(socket().frames[0].token).toBe('new-token');
  });
});

describe('backoff', () => {
  it('doubles from 1s to a 60s ceiling and resets on a successful hello', async () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(bridge.backoffDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
    ]);

    await bridge.ensureConnected();
    const seen = [];
    for (let i = 0; i < 8; i += 1) {
      socket().serverClose(1006);
      seen.push(timers[timers.length - 1].ms);
      await fireTimers();
    }
    expect(seen).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);

    socket().open();
    socket().deliver({ type: 'hello_ok', serverVersion: '2.0.0' });
    expect(bridge.bridgeState().attempts).toBe(0);
  });

  it('only ever schedules one retry at a time', async () => {
    await bridge.ensureConnected();
    socket().serverClose(1006);
    socket().serverClose(1006);
    expect(timers).toHaveLength(1);
  });
});

describe('requests', () => {
  beforeEach(() => {
    resetEngine();
    register(ACTIONS.STATUS_GET, () => ({ connected: true, extensionVersion: '2.0.0' }));
    register(ACTIONS.LIST_CREATE, ({ name }) => ({ listId: 'list_1', name }));
  });

  it('runs the action with origin mcp and answers with the request id', async () => {
    await connect();
    const seenOrigin = [];
    register(ACTIONS.LIST_GET_ALL, (_params, ctx) => {
      seenOrigin.push(ctx.origin);
      return { lists: [] };
    });

    socket().deliver({ id: 'req-42', action: ACTIONS.LIST_GET_ALL, params: {} });
    await new Promise((r) => setTimeout(r, 0));

    const response = socket().frames[socket().frames.length - 1];
    expect(response.id).toBe('req-42');
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ lists: [] });
    expect(seenOrigin).toEqual(['mcp']);
  });

  it('passes params through and answers errors in the envelope', async () => {
    await connect();
    socket().deliver({ id: 'r1', action: ACTIONS.LIST_CREATE, params: { name: 'Targets' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(socket().frames[socket().frames.length - 1].data).toEqual({
      listId: 'list_1',
      name: 'Targets',
    });

    socket().deliver({ id: 'r2', action: ACTIONS.LIST_CREATE, params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const failure = socket().frames[socket().frames.length - 1];
    expect(failure).toMatchObject({ id: 'r2', ok: false });
    expect(failure.error.code).toBe('INVALID_PARAMS');
  });

  it('ignores frames that are not JSON', async () => {
    await connect();
    const before = socket().frames.length;
    socket().onmessage({ data: 'not json' });
    expect(socket().frames).toHaveLength(before);
  });

  it('answers an application-level ping', async () => {
    await connect();
    socket().deliver({ type: 'ping' });
    expect(socket().frames[socket().frames.length - 1]).toEqual({ type: 'pong' });
  });
});

describe('events', () => {
  it('pushes event frames once connected and stops on disconnect', async () => {
    await connect();
    await events.emit(EVENTS.QUEUE_ITEM_ADDED, { id: 'q1' });

    expect(socket().frames[socket().frames.length - 1]).toEqual({
      event: 'queue_item_added',
      payload: { id: 'q1' },
    });

    const s = socket();
    s.serverClose(1006);
    const before = s.frames.length;
    await events.emit(EVENTS.QUEUE_ITEM_ADDED, { id: 'q2' });
    expect(s.frames).toHaveLength(before);
  });
});

describe('keepalive', () => {
  it('creates a one-minute alarm and reconnects on its tick', async () => {
    bridge.startKeepalive();
    expect(chrome.__mock.alarms.get(bridge.KEEPALIVE_ALARM)).toEqual({ periodInMinutes: 1 });

    expect(await bridge.onAlarm({ name: 'somethingElse' })).toBe(false);
    expect(FakeSocket.instances).toHaveLength(0);

    expect(await bridge.onAlarm({ name: bridge.KEEPALIVE_ALARM })).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe('resilience', () => {
  it('survives a constructor that throws and schedules a retry', async () => {
    bridge.setWebSocketFactory(
      class {
        constructor() {
          throw new Error('ECONNREFUSED');
        }
      },
    );
    const res = await bridge.ensureConnected();
    expect(res).toEqual({ connected: false, reason: 'error' });
    expect(bridge.bridgeState().lastError).toMatch(/ECONNREFUSED/);
    expect(timers).toHaveLength(1);
  });

  it('a send on a dead socket does not throw', async () => {
    await connect();
    socket().send = () => {
      throw new Error('closed');
    };
    await expect(events.emit(EVENTS.QUOTA_HIT, {})).resolves.toBeTruthy();
  });
});

vi.setConfig({ testTimeout: 5000 });
