/**
 * The popup's "connect this site" strip (docs/compose-from-websites.md).
 *
 * Opened on a website that is not LinkedIn, the popup offers to let that site hand
 * the toolkit draft posts. Chrome's permission prompt for that one site has to be
 * asked inside the click, so it is asked here; the background then records the
 * site and puts the bridge script on it.
 */
import { el, render } from '../ui/dom.js';

const LINKEDIN = 'https://www.linkedin.com';

export function siteOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

export async function connect(tab) {
  const site = siteOf(tab && tab.url);
  if (!site) return { ok: false, error: 'This page cannot send posts.' };
  const granted = await chrome.permissions.request({ origins: [`${site}/*`] });
  if (!granted) return { ok: false, error: 'Access to this site was not given.' };
  return chrome.runtime.sendMessage({ type: 'LIT_SITES_CONNECT', url: tab.url, tabId: tab.id });
}

/** Draw the strip into `container`; nothing on LinkedIn or on pages that are not websites. */
export async function paintSiteBar(container) {
  if (!container) return;
  const tab = await activeTab();
  const site = siteOf(tab && tab.url);
  if (!site || site === LINKEDIN) {
    render(container, []);
    container.hidden = true;
    return;
  }
  const res = await chrome.runtime.sendMessage({ type: 'LIT_SITES_LIST' });
  const sites = (res && res.sites) || [];
  const host = new URL(site).host;
  container.hidden = false;
  if (sites.includes(site)) {
    render(container, [
      el('span', { class: 'site-bar__text', text: `${host} can send you posts to finish on LinkedIn.` }),
      el('button', {
        type: 'button',
        class: 'btn btn--link',
        text: 'Disconnect',
        onclick: async () => {
          await chrome.runtime.sendMessage({ type: 'LIT_SITES_DISCONNECT', site });
          paintSiteBar(container);
        },
      }),
    ]);
    return;
  }
  const note = el('span', { class: 'site-bar__text', text: `Let ${host} send you posts? You check each one on LinkedIn and press Post yourself.` });
  render(container, [
    note,
    el('button', {
      type: 'button',
      class: 'btn btn--primary',
      text: 'Connect this site',
      onclick: async () => {
        const out = await connect(tab).catch((e) => ({ ok: false, error: e.message }));
        if (out && out.ok) paintSiteBar(container);
        else note.textContent = (out && out.error) || 'The site could not be connected.';
      },
    }),
  ]);
}
