/**
 * LinkedIn Toolkit — config access.
 *
 * One place to read and write the clamped Config. Hard ceilings are enforced
 * by `clampConfig`, so no caller — popup, bridge, MCP client — can raise them.
 */

import { clampConfig } from './actions.js';
import { K, get, set } from './storage.js';

export async function getConfig() {
  return clampConfig((await get(K.CONFIG, {})) || {});
}

/**
 * Merge a partial config over the stored one, clamp and persist.
 * Nested `warmup` / `ai` / `enrichment` / `bridge` objects are merged one level deep so a
 * partial update never wipes sibling keys.
 */
export async function setConfig(partial) {
  const current = await getConfig();
  const input = partial && typeof partial === 'object' ? partial : {};
  const merged = {
    ...current,
    ...input,
    warmup: { ...current.warmup, ...(input.warmup || {}) },
    ai: { ...current.ai, ...(input.ai || {}) },
    enrichment: { ...current.enrichment, ...(input.enrichment || {}) },
    bridge: { ...current.bridge, ...(input.bridge || {}) },
  };
  const updated = clampConfig(merged);
  await set(K.CONFIG, updated);
  return updated;
}
