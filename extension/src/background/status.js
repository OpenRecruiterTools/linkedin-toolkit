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

/** The contract `Status`. */
export async function status() {
  const config = await getConfig();
  const campaigns = await readCampaigns();
  const bridge = bridgeState();

  return {
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
 * Write config.
 *
 * `clearChallenge: true` is a command, not a setting: it clears a live
 * security challenge and is never persisted.
 */
export async function writeConfig(params = {}) {
  const { clearChallenge, ...rest } = params;
  if (clearChallenge === true) await quota.clearChallenge();

  const updated = await setConfig(rest);

  // Turning the bridge on (or repointing it) should take effect immediately.
  if (updated.bridge.enabled) ensureConnected().catch(() => {});
  return updated;
}

register(ACTIONS.STATUS_GET, () => status());
register(ACTIONS.CONFIG_GET, () => getConfig());
register(ACTIONS.CONFIG_SET, (params) => writeConfig(params));
