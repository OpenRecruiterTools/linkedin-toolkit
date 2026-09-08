/**
 * LinkedIn Toolkit — status and config actions.
 *
 * `status.get` is the one call a client makes to know whether it can do
 * anything at all: are we logged in, is a challenge or a backoff live, what is
 * left in each bucket, how much is waiting for approval, is the bridge up.
 */

import { ACTIONS } from '../lib/actions.js';
import { getConfig, setConfig } from '../lib/config.js';
import { register } from './engine.js';
import { bridgeState, ensureConnected } from './bridge.js';
import { readCampaigns } from './campaigns.js';
import { pendingCount } from './queue.js';
import * as quota from './quota.js';
import { isLoggedIn } from './voyager-core.js';
import { verifyEndpoints } from './voyager.js';

/**
 * Charge the two self-check calls that cost something.
 *
 * The self-check reads one search result and looks at the signed-in user's own
 * profile; both are metered exactly as the real actions are, so running the
 * check cannot be a way around the caps. Everything else it touches — `/me`,
 * a company, a page of one conversation — is free.
 */
async function meterSelfCheck(kind, n) {
  if (kind === 'visit') {
    await quota.reserve('visit');
    return;
  }
  await quota.check(kind, n);
  await quota.record(kind, n);
}

/**
 * The contract `Status`.
 *
 * `verify: true` additionally runs a read-only pass over every endpoint the
 * engine depends on and reports one word per endpoint. It exists because a
 * LinkedIn release breaks endpoints one at a time and silently: the query ids
 * in `ENDPOINTS` go stale, and until something is actually called nobody
 * knows which. `postUrl` gives the reaction check a post to count likes on;
 * without one that single endpoint is reported `skipped`.
 */
export async function status({ verify = false, postUrl } = {}) {
  const config = await getConfig();
  const campaigns = await readCampaigns();
  const bridge = bridgeState();

  const verification = verify
    ? await verifyEndpoints({ probes: { postUrl }, meter: meterSelfCheck })
    : null;

  return {
    ...(verification
      ? {
          endpoints: verification.endpoints,
          clientVersionCaptured: verification.clientVersionCaptured,
          endpointsCapturedAt: verification.capturedAt,
          ...(Object.keys(verification.errors).length
            ? { endpointErrors: verification.errors }
            : {}),
        }
      : {}),
    connected: true,
    extensionVersion: chrome.runtime.getManifest().version,
    loggedIn: await isLoggedIn(),
    autopilot: config.autopilot,
    businessHours: config.businessHoursOnly ? quota.isWithinBusinessHours(config) : true,
    ...(await quota.pauseState()),
    quotas: await quota.snapshotAll(),
    queue: { pending: await pendingCount() },
    campaigns: {
      active: campaigns.filter((c) => c.status === 'active').length,
      paused: campaigns.filter((c) => c.status === 'paused').length,
    },
    bridge: {
      enabled: !!config.bridge.enabled,
      connected: bridge.connected,
      port: config.bridge.port,
    },
  };
}

/**
 * The keys only the human at the popup may write.
 *
 * Every one of them is either a safety setting (the caps, the delays, the
 * business-hours window, warm-up), a credential (`ai`, `enrichment`,
 * `bridge`), the switch that empties the approval queue (`autopilot`), or the
 * command that waves away LinkedIn telling us to stop (`clearChallenge`). An
 * agent that could set any of them could quietly remove every limit it is
 * subject to, so a non-popup caller may set `webhookUrl` and nothing else.
 *
 * They are dropped silently rather than rejected — an agent tidying up its own
 * settings should not fail hard — but the result names what was ignored, so
 * nobody is left believing a cap was raised.
 */
export const POPUP_ONLY_CONFIG_KEYS = Object.freeze([
  'autopilot',
  'clearChallenge',
  'bridge',
  'ai',
  'enrichment',
  'accountPreset',
  'warmup',
  'businessHoursOnly',
  'businessStart',
  'businessEnd',
  'weekdaysOnly',
  'minDelayMs',
  'maxDelayMs',
  'hourlyCap',
  'dailyInviteCap',
  'dailyMessageCap',
  'dailyVisitCap',
  'dailySearchCap',
]);

/** `sk-abcd…wxyz` → `****wxyz`; unset stays unset. */
function mask(value) {
  return typeof value === 'string' && value !== '' ? `****${value.slice(-4)}` : undefined;
}

function maskKey(section, key) {
  const { [key]: secret, ...rest } = section || {};
  const masked = mask(secret);
  return masked === undefined ? rest : { ...rest, [key]: masked };
}

/**
 * The Config as anyone but the popup may see it: the three secrets it carries
 * come back as their last four characters, or not at all. The popup is the
 * only surface that has to render a key for editing.
 */
export function redactConfig(config) {
  return {
    ...config,
    ai: maskKey(config.ai, 'apiKey'),
    enrichment: maskKey(config.enrichment, 'apiKey'),
    bridge: maskKey(config.bridge, 'token'),
  };
}

/** `config.get` — redacted for every origin but the popup. */
export async function readConfig(ctx = {}) {
  const config = await getConfig();
  return ctx.origin === 'popup' ? config : redactConfig(config);
}

/**
 * Write config.
 *
 * `clearChallenge: true` is a command, not a setting: it clears a live
 * security challenge and is never persisted.
 *
 * From anywhere but the popup, `POPUP_ONLY_CONFIG_KEYS` are stripped before
 * the merge and listed back as `ignoredKeys`.
 */
export async function writeConfig(params = {}, ctx = {}) {
  const requested = params && typeof params === 'object' ? params : {};
  const restricted = ctx.origin !== 'popup';

  const ignoredKeys = restricted
    ? POPUP_ONLY_CONFIG_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(requested, key))
    : [];
  const allowed = restricted
    ? Object.fromEntries(
        Object.entries(requested).filter(([key]) => !POPUP_ONLY_CONFIG_KEYS.includes(key)),
      )
    : requested;

  const { clearChallenge, ...rest } = allowed;
  if (clearChallenge === true) await quota.clearChallenge();

  const updated = await setConfig(rest);

  // Turning the bridge on (or repointing it) should take effect immediately.
  if (updated.bridge.enabled) ensureConnected().catch(() => {});

  const result = restricted ? redactConfig(updated) : updated;
  return ignoredKeys.length ? { ...result, ignoredKeys } : result;
}

register(ACTIONS.STATUS_GET, (params) => status(params));
register(ACTIONS.CONFIG_GET, (_params, ctx) => readConfig(ctx));
register(ACTIONS.CONFIG_SET, (params, ctx) => writeConfig(params, ctx));
