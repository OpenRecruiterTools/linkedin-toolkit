/**
 * LinkedIn Toolkit — the localhost bridge.
 *
 * A WebSocket client to the MCP server on 127.0.0.1. The extension always
 * dials out; nothing listens inside Chrome. The server sends requests, the
 * extension answers with the envelope `engine.handle` produced (carrying the
 * *request's* id) and pushes events as they happen.
 *
 * Protocol:
 *   extension → { type: 'hello', token, extensionVersion }
 *   server    → { type: 'hello_ok', serverVersion } | close 4001 (UNAUTHORIZED)
 *   server    → { id, action, params, origin? }   (origin 'mcp' | 'cli')
 *   extension → { id, ok: true, data } | { id, ok: false, error }
 *   extension → { event, payload }
 *
 * Reconnect backoff is 1s → 2s → 4s → … → 60s, reset on a successful hello.
 */

import { getConfig } from '../lib/config.js';
import { handle } from './engine.js';
import { setSink } from './events.js';

export const BACKOFF_START_MS = 1000;
export const BACKOFF_MAX_MS = 60000;
export const KEEPALIVE_ALARM = 'bridge-keepalive';
export const UNAUTHORIZED_CLOSE_CODE = 4001;

/* ------------------------------------------------------------------ */
/*  Injection points (tests replace these)                            */
/* ------------------------------------------------------------------ */

let WebSocketImpl = typeof WebSocket === 'function' ? WebSocket : null;
let timerFn = (fn, ms) => setTimeout(fn, ms);

export function setWebSocketFactory(impl) {
  WebSocketImpl = impl || (typeof WebSocket === 'function' ? WebSocket : null);
}

export function setTimerFn(fn) {
  timerFn = typeof fn === 'function' ? fn : (cb, ms) => setTimeout(cb, ms);
}

/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */

const state = {
  socket: null,
  connected: false,
  connecting: false,
  attempts: 0,
  unauthorized: false,
  tokenUsed: null,
  serverVersion: null,
  lastError: null,
  retryScheduled: false,
};

/** The delay before retry number `attempt` (0-based). */
export function backoffDelay(attempt) {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.max(0, attempt));
}

export function isConnected() {
  return state.connected;
}

export function bridgeState() {
  return {
    connected: state.connected,
    connecting: state.connecting,
    attempts: state.attempts,
    unauthorized: state.unauthorized,
    serverVersion: state.serverVersion,
    lastError: state.lastError,
    nextRetryMs: state.connected ? 0 : backoffDelay(state.attempts),
  };
}

/** Drop the connection and forget the backoff (used by tests and by config changes). */
export function disconnect() {
  if (state.socket) {
    try {
      state.socket.close();
    } catch {
      /* already gone */
    }
  }
  state.socket = null;
  state.connected = false;
  state.connecting = false;
  state.attempts = 0;
  state.unauthorized = false;
  state.tokenUsed = null;
  state.serverVersion = null;
  state.retryScheduled = false;
  setSink(null);
}

/* ------------------------------------------------------------------ */
/*  Framing                                                           */
/* ------------------------------------------------------------------ */

function sendFrame(frame) {
  if (!state.socket || !state.connected) return false;
  try {
    state.socket.send(JSON.stringify(frame));
    return true;
  } catch (e) {
    state.lastError = e.message;
    return false;
  }
}

/** Origins a bridge client may claim. Both follow the same queue rule. */
const BRIDGE_ORIGINS = new Set(['mcp', 'cli']);

async function onRequest(frame) {
  const origin = BRIDGE_ORIGINS.has(frame.origin) ? frame.origin : 'mcp';
  const envelope = await handle(frame.action, frame.params || {}, origin);
  sendFrame({ ...envelope, id: frame.id });
}

async function onMessage(raw) {
  let frame;
  try {
    frame = JSON.parse(typeof raw === 'string' ? raw : String(raw));
  } catch {
    return;
  }

  if (frame.type === 'hello_ok') {
    state.connected = true;
    state.connecting = false;
    state.attempts = 0;
    state.serverVersion = frame.serverVersion || null;
    state.lastError = null;
    setSink((event) => sendFrame(event));
    return;
  }

  if (frame.type === 'ping') {
    sendFrame({ type: 'pong' });
    return;
  }

  if (frame.action) await onRequest(frame);
}

function scheduleRetry() {
  if (state.retryScheduled || state.unauthorized) return;
  const delay = backoffDelay(state.attempts);
  state.attempts += 1;
  state.retryScheduled = true;
  timerFn(() => {
    state.retryScheduled = false;
    ensureConnected().catch(() => {});
  }, delay);
}

function onClose(event) {
  const code = event && event.code;
  state.connected = false;
  state.connecting = false;
  state.socket = null;
  setSink(null);

  if (code === UNAUTHORIZED_CLOSE_CODE) {
    state.unauthorized = true;
    state.lastError = 'UNAUTHORIZED: the bridge token was rejected.';
    return;
  }
  scheduleRetry();
}

/* ------------------------------------------------------------------ */
/*  Connect                                                           */
/* ------------------------------------------------------------------ */

/**
 * Connect if the bridge is enabled and we are not already connected.
 * Safe to call as often as you like — it is what the keepalive alarm and every
 * service-worker wake-up call.
 *
 * @returns {Promise<{connected: boolean, reason?: string}>}
 */
export async function ensureConnected() {
  const config = await getConfig();
  const bridge = config.bridge || {};

  if (!bridge.enabled) {
    if (state.socket) disconnect();
    return { connected: false, reason: 'disabled' };
  }
  if (state.connected) return { connected: true };
  if (state.connecting) return { connected: false, reason: 'connecting' };

  // A new token is a new chance: forget an earlier rejection.
  if (state.unauthorized && bridge.token !== state.tokenUsed) state.unauthorized = false;
  if (state.unauthorized) return { connected: false, reason: 'unauthorized' };

  if (!WebSocketImpl) return { connected: false, reason: 'no-websocket' };

  const url = `ws://127.0.0.1:${bridge.port || 47829}`;
  state.connecting = true;
  state.tokenUsed = bridge.token || null;

  let socket;
  try {
    socket = new WebSocketImpl(url);
  } catch (e) {
    state.connecting = false;
    state.lastError = e.message;
    scheduleRetry();
    return { connected: false, reason: 'error' };
  }

  state.socket = socket;

  socket.onopen = () => {
    sendHello(bridge.token);
  };
  socket.onmessage = (event) => {
    onMessage(event && event.data !== undefined ? event.data : event);
  };
  socket.onclose = onClose;
  socket.onerror = (e) => {
    state.lastError = (e && e.message) || 'socket error';
  };

  return { connected: false, reason: 'connecting' };
}

function sendHello(token) {
  try {
    state.socket.send(
      JSON.stringify({
        type: 'hello',
        token: token || '',
        extensionVersion: chrome.runtime.getManifest().version,
      }),
    );
  } catch (e) {
    state.lastError = e.message;
  }
}

/* ------------------------------------------------------------------ */
/*  Keepalive                                                         */
/* ------------------------------------------------------------------ */

/** Create the 1-minute keepalive alarm. Idempotent. */
export function startKeepalive() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
}

/** Handle one alarm tick; returns true when it was ours. */
export async function onAlarm(alarm) {
  if (!alarm || alarm.name !== KEEPALIVE_ALARM) return false;
  await ensureConnected();
  return true;
}
