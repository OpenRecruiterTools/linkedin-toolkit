/**
 * LinkedIn Toolkit — full-page capture driver.
 *
 * `profile.get { full: true }` needs what the Voyager API does not return: the
 * rendered page text and the profile photo. That only exists in a tab, so this
 * module reuses an open tab on that profile or opens a background one, asks
 * the content script for a capture, and tidies up after itself.
 *
 * A capture that fails is never fatal: `profile.get` still answers with the
 * API profile.
 */

import { setFullCapture } from './extract.js';

const DEFAULT_MAX_WAIT_MS = 15000;
const READY_RETRIES = 3;

let sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setSleepFn(fn) {
  sleepFn = typeof fn === 'function' ? fn : (ms) => new Promise((r) => setTimeout(r, ms));
}

/** An already-open tab showing this profile, if there is one. */
async function findTab(publicId) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/in/*' });
    return (tabs || []).find((t) => String(t.url || '').includes(`/in/${publicId}`)) || null;
  } catch {
    return null;
  }
}

/** Resolve when the tab reports `complete`, or when the wait runs out. */
function waitForLoad(tabId, maxWaitMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        chrome.tabs.onUpdated.removeListener(listener);
      } catch {
        /* listener may never have been added */
      }
      resolve();
    };

    const listener = (updatedId, info) => {
      if (updatedId === tabId && info && info.status === 'complete') finish();
    };

    try {
      chrome.tabs.onUpdated.addListener(listener);
    } catch {
      /* no tabs API: fall through to the timeout */
    }

    Promise.resolve(chrome.tabs.get(tabId))
      .then((tab) => {
        if (tab && tab.status === 'complete') finish();
      })
      .catch(() => {});

    sleepFn(maxWaitMs).then(finish);
  });
}

/** Ask the content script for a capture, allowing for it not being ready yet. */
async function requestCapture(tabId) {
  for (let attempt = 0; attempt < READY_RETRIES; attempt += 1) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_FULL' });
      if (result && (result.pageText || result.photoDataUrl || result.sections)) return result;
    } catch {
      /* the content script has not attached yet */
    }
    await sleepFn(500);
  }
  return null;
}

/**
 * Capture the rendered profile page.
 *
 * @param {object} profile the contract Profile the API already returned
 * @param {{maxWaitMs?: number}} [options]
 * @returns {Promise<{pageText, photoDataUrl, sections}|null>} null when the
 *   capture could not be made
 */
export async function captureFull(profile, options = {}) {
  const publicId = profile && profile.publicId;
  if (!publicId) return null;

  const maxWaitMs = options.maxWaitMs || DEFAULT_MAX_WAIT_MS;
  const url = profile.url || `https://www.linkedin.com/in/${publicId}/`;

  let tab = await findTab(publicId);
  let opened = false;

  if (!tab) {
    try {
      tab = await chrome.tabs.create({ url, active: false });
      opened = true;
    } catch {
      return null;
    }
    if (!tab || tab.id === undefined) return null;
    await waitForLoad(tab.id, maxWaitMs);
  }

  const captured = await requestCapture(tab.id);

  if (opened) {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      /* the user may have closed it already */
    }
  }

  if (!captured) return null;
  return {
    pageText: captured.pageText || '',
    photoDataUrl: captured.photoDataUrl || '',
    sections: captured.sections || {},
  };
}

setFullCapture(captureFull);
