/**
 * Vitest setup — an in-memory `chrome` mock.
 *
 * The extension has no build step and no runtime dependencies, so tests load
 * the real service-worker modules and give them a `globalThis.chrome` that
 * behaves like MV3's promise-based API. Everything is in memory: no network,
 * no browser, nothing to clean up but `resetChrome()`.
 */
import { beforeEach, vi } from 'vitest';

const MANIFEST = { version: '2.0.0', name: 'LinkedIn Toolkit', manifest_version: 3 };

/** Mutable backing state; also reachable from tests via `chrome.__mock`. */
const mock = {
  storage: new Map(),
  alarms: new Map(),
  tabs: new Map(),
  cookies: new Map(),
  notifications: [],
  downloads: [],
  messages: [],
  tabMessages: [],
  listeners: {
    onMessage: [],
    onStartup: [],
    onInstalled: [],
    onAlarm: [],
    onTabUpdated: [],
  },
  /** Queue of results returned by successive `chrome.scripting.executeScript` calls. */
  executeScriptResults: [],
  /** Fallback result when the queue is empty. */
  executeScriptResult: [{ result: null }],
  executeScriptCalls: [],
  lastError: undefined,
  nextTabId: 1,
  /** Optional host permissions. Everything is granted unless a test says otherwise. */
  grantAllPermissions: true,
  grantedOrigins: new Set(),
};

function settle(value, callback) {
  if (typeof callback === 'function') callback(value);
  return Promise.resolve(value);
}

/* ------------------------------------------------------------------ */
/*  chrome.storage.local                                              */
/* ------------------------------------------------------------------ */

function storageGet(keys, callback) {
  const out = {};
  if (keys === undefined || keys === null) {
    for (const [k, v] of mock.storage) out[k] = v;
  } else if (typeof keys === 'string') {
    if (mock.storage.has(keys)) out[keys] = mock.storage.get(keys);
  } else if (Array.isArray(keys)) {
    for (const k of keys) if (mock.storage.has(k)) out[k] = mock.storage.get(k);
  } else if (typeof keys === 'object') {
    for (const [k, fallback] of Object.entries(keys)) {
      out[k] = mock.storage.has(k) ? mock.storage.get(k) : fallback;
    }
  }
  return settle(structuredClone(out), callback);
}

function storageSet(items, callback) {
  for (const [k, v] of Object.entries(items || {})) mock.storage.set(k, structuredClone(v));
  return settle(undefined, callback);
}

function storageRemove(keys, callback) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) mock.storage.delete(k);
  return settle(undefined, callback);
}

function storageClear(callback) {
  mock.storage.clear();
  return settle(undefined, callback);
}

/* ------------------------------------------------------------------ */
/*  The mock itself                                                   */
/* ------------------------------------------------------------------ */

function buildChrome() {
  return {
    __mock: mock,

    get runtime() {
      return runtime;
    },

    storage: {
      local: {
        get: vi.fn(storageGet),
        set: vi.fn(storageSet),
        remove: vi.fn(storageRemove),
        clear: vi.fn(storageClear),
      },
    },

    alarms: {
      create: vi.fn((name, info) => {
        mock.alarms.set(name, info || {});
      }),
      clear: vi.fn((name, callback) => settle(mock.alarms.delete(name), callback)),
      clearAll: vi.fn((callback) => {
        mock.alarms.clear();
        return settle(true, callback);
      }),
      get: vi.fn((name, callback) =>
        settle(mock.alarms.has(name) ? { name, ...mock.alarms.get(name) } : undefined, callback),
      ),
      getAll: vi.fn((callback) =>
        settle(
          [...mock.alarms.entries()].map(([name, info]) => ({ name, ...info })),
          callback,
        ),
      ),
      onAlarm: {
        addListener: vi.fn((fn) => mock.listeners.onAlarm.push(fn)),
        removeListener: vi.fn((fn) => {
          mock.listeners.onAlarm = mock.listeners.onAlarm.filter((f) => f !== fn);
        }),
      },
    },

    tabs: {
      create: vi.fn((props, callback) => {
        const tab = { id: mock.nextTabId++, active: true, ...props };
        mock.tabs.set(tab.id, tab);
        return settle(tab, callback);
      }),
      update: vi.fn((tabId, props, callback) => {
        const tab = { ...(mock.tabs.get(tabId) || { id: tabId }), ...props };
        mock.tabs.set(tabId, tab);
        return settle(tab, callback);
      }),
      remove: vi.fn((tabId, callback) => {
        for (const id of Array.isArray(tabId) ? tabId : [tabId]) mock.tabs.delete(id);
        return settle(undefined, callback);
      }),
      get: vi.fn((tabId, callback) => settle(mock.tabs.get(tabId), callback)),
      query: vi.fn((info, callback) => {
        let tabs = [...mock.tabs.values()];
        if (info && info.active !== undefined)
          tabs = tabs.filter((t) => !!t.active === info.active);
        return settle(tabs, callback);
      }),
      sendMessage: vi.fn((tabId, message, callback) => {
        mock.tabMessages.push({ tabId, message });
        return settle(undefined, callback);
      }),
      onUpdated: {
        addListener: vi.fn((fn) => mock.listeners.onTabUpdated.push(fn)),
        removeListener: vi.fn((fn) => {
          mock.listeners.onTabUpdated = mock.listeners.onTabUpdated.filter((f) => f !== fn);
        }),
      },
    },

    cookies: {
      get: vi.fn((details, callback) => {
        const key = `${details.url || ''}|${details.name}`;
        const byName = mock.cookies.get(details.name);
        return settle(mock.cookies.get(key) || byName || null, callback);
      }),
      getAll: vi.fn((details, callback) => settle([...mock.cookies.values()], callback)),
    },

    notifications: {
      create: vi.fn((idOrOptions, maybeOptions, callback) => {
        const hasId = typeof idOrOptions === 'string';
        const id = hasId ? idOrOptions : `notif_${mock.notifications.length + 1}`;
        mock.notifications.push({ id, options: hasId ? maybeOptions : idOrOptions });
        return settle(id, hasId ? callback : maybeOptions);
      }),
      clear: vi.fn((id, callback) => settle(true, callback)),
    },

    scripting: {
      executeScript: vi.fn((injection, callback) => {
        mock.executeScriptCalls.push(injection);
        const next = mock.executeScriptResults.length
          ? mock.executeScriptResults.shift()
          : mock.executeScriptResult;
        return settle(next, callback);
      }),
    },

    permissions: {
      contains: vi.fn((query, callback) => {
        const origins = (query && query.origins) || [];
        const granted =
          mock.grantAllPermissions || origins.every((o) => mock.grantedOrigins.has(o));
        return settle(granted, callback);
      }),
      request: vi.fn((query, callback) => {
        for (const origin of (query && query.origins) || []) mock.grantedOrigins.add(origin);
        return settle(true, callback);
      }),
      remove: vi.fn((query, callback) => {
        for (const origin of (query && query.origins) || []) mock.grantedOrigins.delete(origin);
        return settle(true, callback);
      }),
      getAll: vi.fn((callback) => settle({ origins: [...mock.grantedOrigins] }, callback)),
    },

    downloads: {
      download: vi.fn((options, callback) => {
        mock.downloads.push(options);
        return settle(mock.downloads.length, callback);
      }),
    },
  };
}

const runtime = {
  id: 'linkedin-toolkit-test',
  getManifest: vi.fn(() => ({ ...MANIFEST })),
  getURL: vi.fn((path) => `chrome-extension://linkedin-toolkit-test/${path}`),
  sendMessage: vi.fn((message, callback) => {
    mock.messages.push(message);
    return settle(undefined, callback);
  }),
  onMessage: {
    addListener: vi.fn((fn) => mock.listeners.onMessage.push(fn)),
    removeListener: vi.fn((fn) => {
      mock.listeners.onMessage = mock.listeners.onMessage.filter((f) => f !== fn);
    }),
  },
  onStartup: {
    addListener: vi.fn((fn) => mock.listeners.onStartup.push(fn)),
    removeListener: vi.fn((fn) => {
      mock.listeners.onStartup = mock.listeners.onStartup.filter((f) => f !== fn);
    }),
  },
  onInstalled: {
    addListener: vi.fn((fn) => mock.listeners.onInstalled.push(fn)),
    removeListener: vi.fn((fn) => {
      mock.listeners.onInstalled = mock.listeners.onInstalled.filter((f) => f !== fn);
    }),
  },
  get lastError() {
    return mock.lastError;
  },
};

/**
 * Wipe all mock state (storage, alarms, tabs, recorded calls) but keep the
 * registered listeners, because service-worker modules register those once at
 * import time and are not re-imported between tests.
 */
export function resetChrome() {
  mock.storage.clear();
  mock.alarms.clear();
  mock.tabs.clear();
  mock.cookies.clear();
  mock.notifications.length = 0;
  mock.downloads.length = 0;
  mock.messages.length = 0;
  mock.tabMessages.length = 0;
  mock.executeScriptResults.length = 0;
  mock.executeScriptCalls.length = 0;
  mock.executeScriptResult = [{ result: null }];
  mock.lastError = undefined;
  mock.nextTabId = 1;
  mock.grantAllPermissions = true;
  mock.grantedOrigins.clear();

  globalThis.chrome = buildChrome();
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map(),
    json: async () => ({}),
    text: async () => '',
  }));
  return globalThis.chrome;
}

/** Convenience for tests: seed one active tab. */
export function setActiveTab(url, props = {}) {
  const tab = { id: mock.nextTabId++, active: true, url, ...props };
  mock.tabs.set(tab.id, tab);
  return tab;
}

resetChrome();

beforeEach(() => {
  resetChrome();
});
