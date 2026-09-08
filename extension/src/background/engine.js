/**
 * LinkedIn Toolkit — engine.
 *
 * One entry point for every action, whatever the origin: the popup, an alarm,
 * the localhost bridge (MCP server / CLI / clients). Feature modules register
 * handlers under contract action names; the engine validates params, runs the
 * handler and shapes the response envelope.
 *
 * Nothing here knows about LinkedIn, storage or quotas — those live in the
 * modules that call `register()`.
 */

import { ACTIONS, ERROR, EngineError, validateParams, ok, err } from '../lib/actions.js';

export { EngineError };

/** action → handler(params, ctx) */
const handlers = new Map();

/** Optional hook, wired by the quota module: (kind) => RateLimit. */
let rateLimitProvider = null;

const KNOWN_ACTIONS = new Set(Object.values(ACTIONS));

/**
 * Which quota bucket an outreach action draws from. The contract has exactly
 * four buckets ('invite' | 'message' | 'visit' | 'search'); the light-touch
 * writes (follow, like, comment) share the 'visit' bucket with profile views.
 */
const OUTREACH_QUOTA_KIND = {
  [ACTIONS.OUTREACH_INVITE]: 'invite',
  [ACTIONS.OUTREACH_MESSAGE]: 'message',
  [ACTIONS.OUTREACH_INMAIL]: 'message',
  [ACTIONS.OUTREACH_VIEW]: 'visit',
  [ACTIONS.OUTREACH_FOLLOW]: 'visit',
  [ACTIONS.OUTREACH_LIKE]: 'visit',
  [ACTIONS.OUTREACH_COMMENT]: 'visit',
};

let seq = 0;

function nextId() {
  seq += 1;
  return `req_${Date.now().toString(36)}_${seq.toString(36)}`;
}

function isEngineError(e) {
  return (
    e instanceof EngineError || (!!e && e.name === 'EngineError' && typeof e.code === 'string')
  );
}

/**
 * Register the handler for a contract action. A later registration replaces an
 * earlier one, so feature modules can be loaded in any order.
 *
 * @param {string} action one of ACTIONS
 * @param {(params: object, ctx: {origin: string}) => any} fn
 */
export function register(action, fn) {
  if (!KNOWN_ACTIONS.has(action)) {
    throw new Error(`Cannot register unknown action: ${action} (see docs/actions.md)`);
  }
  if (typeof fn !== 'function') {
    throw new Error(`Handler for ${action} must be a function`);
  }
  handlers.set(action, fn);
  return fn;
}

/** True when some module has claimed this action. */
export function isRegistered(action) {
  return handlers.has(action);
}

/** Every action that currently has a handler. */
export function registeredActions() {
  return [...handlers.keys()];
}

/**
 * Install the quota hook. `fn(kind)` returns (or resolves to) a RateLimit for
 * one of 'invite' | 'message' | 'visit' | 'search'. Pass null to remove it.
 */
export function setRateLimitProvider(fn) {
  rateLimitProvider = typeof fn === 'function' ? fn : null;
}

/** Drop all handlers and the rate-limit hook (tests, and re-init). */
export function resetEngine() {
  handlers.clear();
  rateLimitProvider = null;
}

async function resolveRateLimit(action) {
  if (!rateLimitProvider) return undefined;
  const kind = OUTREACH_QUOTA_KIND[action];
  if (!kind) return undefined;
  try {
    const rl = await rateLimitProvider(kind);
    return rl || undefined;
  } catch {
    // A broken or not-yet-wired quota module must never fail a completed write.
    return undefined;
  }
}

/**
 * Run one action.
 *
 * @param {string} action one of ACTIONS
 * @param {object} [params]
 * @param {'popup'|'campaign'|'mcp'|'cli'|'system'} [origin]
 * @returns {Promise<object>} `{id, ok:true, data, rateLimit?}` | `{id, ok:false, error}`
 */
export async function handle(action, params = {}, origin = 'popup') {
  const id = nextId();

  const check = validateParams(action, params);
  if (!check.ok) return err(id, ERROR.INVALID_PARAMS, check.message);

  const fn = handlers.get(action);
  if (!fn) return err(id, ERROR.NOT_FOUND, `no handler registered for ${action}`);

  try {
    const data = await fn(params, { origin });
    const rateLimit = action.startsWith('outreach.') ? await resolveRateLimit(action) : undefined;
    return ok(id, data, rateLimit);
  } catch (e) {
    if (isEngineError(e)) return err(id, e.code, e.message, e.extra);
    return err(id, ERROR.INTERNAL, (e && e.message) || String(e));
  }
}
