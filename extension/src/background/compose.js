/**
 * Compose a post from a website (docs/compose-from-websites.md).
 *
 * 1. The person connects a site from the popup. That grants the toolkit access to
 *    that one site and registers a small bridge script there (web-bridge.js).
 * 2. The site posts a draft to the bridge; the bridge passes it here.
 * 3. We keep the draft for a few minutes and open LinkedIn's post box in a new tab.
 * 4. The LinkedIn tab takes the draft and fills the post box (compose-linkedin.js).
 *    Nobody presses Post but the person.
 */

import { checkDraft, siteOf } from '../lib/compose.js';

export const SITES_KEY = 'composeSites';
export const LINKEDIN = 'https://www.linkedin.com';
export const COMPOSE_URL = `${LINKEDIN}/feed/?shareActive=true&lit_compose=`;
export const PENDING_TTL_MS = 5 * 60 * 1000;
export const BRIDGE_SCRIPT = 'src/content/web-bridge.js';

const pending = new Map(); // id -> { draft, site, expires }

function scriptId(site) {
  return `lit-web-bridge-${site.replace(/[^a-z0-9]+/gi, '-')}`;
}

export async function getSites() {
  const got = await chrome.storage.local.get(SITES_KEY);
  return Array.isArray(got[SITES_KEY]) ? got[SITES_KEY] : [];
}

async function saveSites(sites) {
  await chrome.storage.local.set({ [SITES_KEY]: [...new Set(sites)].sort() });
}

/**
 * Connect a site. The popup asks Chrome for the site's permission first (that has
 * to happen inside the click); this records the site and puts the bridge there.
 */
export async function connectSite(url, tabId) {
  const site = siteOf(url);
  if (!site || site === LINKEDIN) return { ok: false, error: 'This page cannot send posts.' };
  const granted = await chrome.permissions.contains({ origins: [`${site}/*`] });
  if (!granted) return { ok: false, error: 'Chrome did not give the toolkit access to this site.' };
  if (chrome.scripting.registerContentScripts) {
    const id = scriptId(site);
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    } catch {
      /* not registered yet */
    }
    await chrome.scripting.registerContentScripts([
      { id, matches: [`${site}/*`], js: [BRIDGE_SCRIPT], runAt: 'document_idle', persistAcrossSessions: true },
    ]);
  }
  if (typeof tabId === 'number') {
    // the page that is already open gets the bridge now, not on its next load
    await chrome.scripting.executeScript({ target: { tabId }, files: [BRIDGE_SCRIPT] }).catch(() => {});
  }
  await saveSites([...(await getSites()), site]);
  return { ok: true, site };
}

export async function disconnectSite(site) {
  if (chrome.scripting.unregisterContentScripts) {
    await chrome.scripting.unregisterContentScripts({ ids: [scriptId(site)] }).catch(() => {});
  }
  await chrome.permissions.remove({ origins: [`${site}/*`] }).catch(() => {});
  await saveSites((await getSites()).filter((s) => s !== site));
  return { ok: true };
}

function sweep(now = Date.now()) {
  for (const [id, p] of pending) if (p.expires < now) pending.delete(id);
}

/** A draft from a connected site's page: keep it and open LinkedIn's post box. */
export async function composeFromSite(raw, sender) {
  const site = siteOf(sender && sender.url);
  if (!site || !(await getSites()).includes(site)) {
    return { ok: false, error: 'This site is not connected. Open LinkedIn Toolkit on this page and connect it.' };
  }
  const checked = checkDraft(raw);
  if (!checked.ok) return checked;
  sweep();
  const id = crypto.randomUUID();
  pending.set(id, { draft: checked.draft, site, expires: Date.now() + PENDING_TTL_MS });
  await chrome.tabs.create({ url: COMPOSE_URL + encodeURIComponent(id), active: true });
  return { ok: true };
}

/** The LinkedIn tab collects its draft (once). */
export function takeDraft(id, sender) {
  if (siteOf(sender && sender.url) !== LINKEDIN) return { ok: false, error: 'Only LinkedIn can collect a draft.' };
  sweep();
  const p = pending.get(id);
  if (!p) return { ok: false, error: 'This draft has expired. Send it again from the website.' };
  pending.delete(id);
  return { ok: true, draft: p.draft, site: p.site };
}

/** When a file could not be attached, it is saved to Downloads so the person can add it by hand. */
export async function downloadDraftFile(file) {
  if (!file || !file.data) return { ok: false };
  await chrome.downloads.download({ url: `data:${file.type};base64,${file.data}`, filename: file.name, saveAs: false });
  return { ok: true };
}

/**
 * Messages for this feature. Returns undefined when the message is not ours.
 * Pages other than LinkedIn may only send LIT_COMPOSE; the site list is the popup's.
 */
export function handleComposeMessage(msg, sender) {
  switch (msg && msg.type) {
    case 'LIT_COMPOSE':
      return composeFromSite(msg.draft, sender);
    case 'LIT_COMPOSE_TAKE':
      return Promise.resolve(takeDraft(msg.id, sender));
    case 'LIT_COMPOSE_DOWNLOAD':
      if (siteOf(sender && sender.url) !== LINKEDIN) return Promise.resolve({ ok: false });
      return downloadDraftFile(msg.file);
    case 'LIT_SITES_LIST':
      if (sender && sender.tab) return Promise.resolve({ ok: false });
      return getSites().then((sites) => ({ ok: true, sites }));
    case 'LIT_SITES_CONNECT':
      if (sender && sender.tab) return Promise.resolve({ ok: false });
      return connectSite(msg.url, msg.tabId);
    case 'LIT_SITES_DISCONNECT':
      if (sender && sender.tab) return Promise.resolve({ ok: false });
      return disconnectSite(msg.site);
    default:
      return undefined;
  }
}

/** True when a message comes from a tab that is not LinkedIn (a connected site's bridge). */
export function fromOtherSite(sender) {
  return Boolean(sender && sender.tab && siteOf(sender.url) !== LINKEDIN);
}

export function _resetCompose() {
  pending.clear();
}
