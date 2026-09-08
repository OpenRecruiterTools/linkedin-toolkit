/**
 * LinkedIn Toolkit — Content Script (ISOLATED world)
 *
 * Two jobs:
 *  1. On-page UI — selection checkboxes on search results, a floating action
 *     bar, an "Export Profile" button, toasts.
 *  2. Answering the background's page requests (CAPTURE_FULL, DOM_LIKE,
 *     DOM_FOLLOW, DOM_COMMENT), which are implemented in capture.js and
 *     reached through `globalThis.LITK`.
 *
 * Everything it asks of the background goes through the v2 contract:
 * `{ action, params }` in, `{ ok, data } | { ok: false, error }` back.
 */

(function () {
  'use strict';

  /* ================================================================ */
  /*  Helpers                                                         */
  /* ================================================================ */

  /**
   * Run one contract action in the background.
   * Resolves with `data`; rejects with the envelope's error message.
   */
  function call(action, params) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, params: params || {} }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp) {
          reject(new Error('The extension did not answer.'));
          return;
        }
        if (resp.ok === false || resp.error) {
          const error = resp.error || {};
          reject(new Error(error.message || String(error) || 'Request failed'));
          return;
        }
        resolve(resp.data === undefined ? resp : resp.data);
      });
    });
  }

  function publicIdFromUrl(url) {
    const match = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  /* ================================================================ */
  /*  Toast notifications                                             */
  /* ================================================================ */

  let toastContainer = null;

  function ensureToastContainer() {
    if (toastContainer && document.body.contains(toastContainer)) return;
    toastContainer = document.createElement('div');
    toastContainer.id = 'litk-toast-container';
    document.body.appendChild(toastContainer);
  }

  function showToast(message, type = 'info', duration = 4000) {
    ensureToastContainer();

    const toast = document.createElement('div');
    toast.className = `litk-toast litk-toast--${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('litk-toast--visible');
    });

    setTimeout(() => {
      toast.classList.remove('litk-toast--visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
      setTimeout(() => toast.remove(), 500);
    }, duration);
  }

  /* ================================================================ */
  /*  Search results: checkboxes + bulk actions                       */
  /* ================================================================ */

  const selectedResults = new Set();
  let actionBar = null;

  function injectSearchCheckboxes() {
    const resultCards = document.querySelectorAll(
      '.reusable-search__result-container, ' +
      'li.reusable-search__result-container'
    );

    resultCards.forEach((card) => {
      if (card.querySelector('.litk-checkbox')) return;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'litk-checkbox';
      checkbox.title = 'Select for export';

      const link = card.querySelector('a[href*="/in/"]');
      const profileUrl = link ? link.href : '';
      const nameEl = card.querySelector(
        '.entity-result__title-text a span[aria-hidden="true"], ' +
        '.app-aware-link span[dir="ltr"] > span[aria-hidden="true"]'
      );
      const name = nameEl ? nameEl.textContent.trim() : '';

      checkbox.dataset.url = profileUrl;
      checkbox.dataset.name = name;

      checkbox.addEventListener('change', () => {
        const key = profileUrl || name;
        if (!key) return;

        if (checkbox.checked) {
          selectedResults.add(key);
        } else {
          selectedResults.delete(key);
        }
        updateActionBar();
      });

      card.style.position = 'relative';
      card.insertBefore(checkbox, card.firstChild);
    });
  }

  function updateActionBar() {
    if (selectedResults.size === 0) {
      if (actionBar) {
        actionBar.classList.remove('litk-action-bar--visible');
      }
      return;
    }

    if (!actionBar) {
      actionBar = document.createElement('div');
      actionBar.className = 'litk-action-bar';
      actionBar.innerHTML = `
        <span class="litk-action-bar__count">${selectedResults.size} selected</span>
        <button class="litk-action-bar__btn litk-action-bar__btn--export" title="Export selected profiles to CSV">
          Export Selected (CSV)
        </button>
        <button class="litk-action-bar__btn litk-action-bar__btn--clear" title="Deselect all">
          Clear
        </button>
      `;

      actionBar.querySelector('.litk-action-bar__btn--export').addEventListener('click', exportSelected);
      actionBar.querySelector('.litk-action-bar__btn--clear').addEventListener('click', clearSelection);

      document.body.appendChild(actionBar);
    }

    actionBar.querySelector('.litk-action-bar__count').textContent = `${selectedResults.size} selected`;
    actionBar.classList.add('litk-action-bar--visible');
  }

  async function exportSelected() {
    if (selectedResults.size === 0) return;

    showToast(`Fetching ${selectedResults.size} profiles...`, 'info', 10000);

    const profiles = [];

    for (const urlOrName of selectedResults) {
      const publicId = publicIdFromUrl(urlOrName);
      if (!publicId) continue;

      try {
        profiles.push(await call('profile.get', { publicId }));
      } catch (err) {
        console.warn(`[LinkedIn Toolkit] Failed to export ${urlOrName}:`, err.message);
      }
    }

    if (profiles.length > 0) {
      try {
        // The engine builds the CSV and hands it to chrome.downloads; a
        // content script cannot download on its own.
        const res = await call('export.csv', { kind: 'profiles', profiles, download: true });
        showToast(`Exported ${profiles.length} profiles to ${res.filename}`, 'success');
      } catch (err) {
        showToast(`Export failed: ${err.message}`, 'error');
      }
    } else {
      showToast('No profiles could be exported', 'error');
    }
  }

  function clearSelection() {
    selectedResults.clear();
    document.querySelectorAll('.litk-checkbox').forEach((cb) => {
      cb.checked = false;
    });
    updateActionBar();
  }

  /* ================================================================ */
  /*  Profile page: export button                                     */
  /* ================================================================ */

  function injectProfileExportButton() {
    if (!window.location.pathname.match(/^\/in\/[^/]+\/?$/)) return;
    if (document.querySelector('.litk-export-btn')) return;

    const nameSection = document.querySelector(
      '.pv-top-card, .ph5, .scaffold-layout__main'
    );
    if (!nameSection) return;

    const btn = document.createElement('button');
    btn.className = 'litk-export-btn';
    btn.textContent = 'Export Profile';
    btn.title = 'Export this profile as JSON (LinkedIn Toolkit)';

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Exporting...';

      try {
        const profile = await call('profile.get', { url: window.location.href });

        const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${profile.publicId || 'profile'}.json`;
        a.click();
        URL.revokeObjectURL(url);

        showToast(`Exported ${profile.fullName || 'profile'}`, 'success');
      } catch (err) {
        showToast(`Export failed: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Export Profile';
      }
    });

    const insertTarget =
      nameSection.querySelector('.pv-top-card--list') ||
      nameSection.querySelector('h1')?.parentElement ||
      nameSection;
    insertTarget.appendChild(btn);
  }

  /* ================================================================ */
  /*  Observer — re-inject on SPA navigation                         */
  /* ================================================================ */

  let lastUrl = location.href;

  function onPageChange() {
    const isSearchPage =
      location.pathname.includes('/search/') ||
      location.search.includes('keywords');
    const isProfilePage = /^\/in\/[^/]+\/?$/.test(location.pathname);

    if (isSearchPage) {
      setTimeout(injectSearchCheckboxes, 1500);
    }

    if (isProfilePage) {
      setTimeout(injectProfileExportButton, 1500);
    }
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onPageChange();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Re-inject periodically for dynamically loaded search content
  setInterval(() => {
    if (location.pathname.includes('/search/')) {
      injectSearchCheckboxes();
    }
  }, 3000);

  // Initial injection
  onPageChange();

  /* ================================================================ */
  /*  Listen for progress messages from background                    */
  /* ================================================================ */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return undefined;

    if (msg.type === 'UNFOLLOW_PROGRESS') {
      showToast(`Unfollowed: ${msg.unfollowed} | Remaining: ${msg.remaining}`, 'info', 2000);
      return undefined;
    }

    // Page requests from the background: capture.js does the work. Some of
    // them (a full capture reads the photo bytes) are async.
    const page = globalThis.LITK && globalThis.LITK.handleMessage(msg);
    if (page === null || page === undefined) return undefined;

    Promise.resolve(page)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  });
})();
