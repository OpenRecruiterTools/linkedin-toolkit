/**
 * LinkedIn Toolkit — Options Page Controller
 */

(function () {
  'use strict';

  function send(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp && resp.error) {
          reject(new Error(resp.error));
          return;
        }
        resolve(resp);
      });
    });
  }

  function $(id) { return document.getElementById(id); }

  function setStatus(text, type) {
    const el = $('status');
    el.textContent = text;
    el.className = 'status';
    if (type) el.classList.add(`status--${type}`);
  }

  /* ================================================================ */
  /*  Settings map                                                    */
  /* ================================================================ */

  const fields = [
    { id: 'cfg-minDelayMs', key: 'minDelayMs', valId: 'val-min', suffix: 's', divisor: 1000 },
    { id: 'cfg-maxDelayMs', key: 'maxDelayMs', valId: 'val-max', suffix: 's', divisor: 1000 },
    { id: 'cfg-maxPerHour', key: 'maxPerHour', valId: 'val-hour' },
    { id: 'cfg-maxInvitesPerDay', key: 'maxInvitesPerDay', valId: 'val-invites' },
    { id: 'cfg-maxMessagesPerDay', key: 'maxMessagesPerDay', valId: 'val-messages' },
    { id: 'cfg-windowStartHour', key: 'windowStartHour', valId: 'val-start' },
    { id: 'cfg-windowEndHour', key: 'windowEndHour', valId: 'val-end' },
  ];

  // Live display updates
  fields.forEach((f) => {
    const input = $(f.id);
    if (!input) return;
    input.addEventListener('input', () => {
      const display = $(f.valId);
      if (!display) return;
      const val = f.divisor ? (parseInt(input.value, 10) / f.divisor) : parseInt(input.value, 10);
      display.textContent = val + (f.suffix || '');
    });
  });

  /* ================================================================ */
  /*  Load / Save                                                     */
  /* ================================================================ */

  async function loadConfig() {
    try {
      const config = await send({ type: 'GET_CONFIG' });

      fields.forEach((f) => {
        const input = $(f.id);
        if (!input) return;
        input.value = config[f.key];

        const display = $(f.valId);
        if (display) {
          const val = f.divisor ? (config[f.key] / f.divisor) : config[f.key];
          display.textContent = val + (f.suffix || '');
        }
      });

      $('cfg-windowWeekdaysOnly').checked = config.windowWeekdaysOnly;
    } catch (err) {
      setStatus('Failed to load settings: ' + err.message, 'err');
    }
  }

  $('btn-save').addEventListener('click', async () => {
    const config = {};
    fields.forEach((f) => {
      const input = $(f.id);
      if (input) config[f.key] = parseInt(input.value, 10);
    });
    config.windowWeekdaysOnly = $('cfg-windowWeekdaysOnly').checked;

    try {
      await send({ type: 'SET_CONFIG', config });
      setStatus('Settings saved.', 'ok');
    } catch (err) {
      setStatus('Failed to save: ' + err.message, 'err');
    }
  });

  /* ================================================================ */
  /*  Import / Export                                                  */
  /* ================================================================ */

  $('btn-export').addEventListener('click', async () => {
    try {
      const config = await send({ type: 'GET_CONFIG' });
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'linkedin-toolkit-settings.json';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Settings exported.', 'ok');
    } catch (err) {
      setStatus('Export failed: ' + err.message, 'err');
    }
  });

  $('btn-import').addEventListener('click', () => {
    $('import-area').style.display = 'block';
    $('import-actions').style.display = 'flex';
    $('import-area').value = '';
    $('import-area').focus();
  });

  $('btn-import-cancel').addEventListener('click', () => {
    $('import-area').style.display = 'none';
    $('import-actions').style.display = 'none';
  });

  $('btn-import-confirm').addEventListener('click', async () => {
    const raw = $('import-area').value.trim();
    if (!raw) {
      setStatus('Paste JSON settings first.', 'err');
      return;
    }

    try {
      const config = JSON.parse(raw);
      await send({ type: 'SET_CONFIG', config });
      setStatus('Settings imported and saved.', 'ok');
      $('import-area').style.display = 'none';
      $('import-actions').style.display = 'none';
      await loadConfig();
    } catch (err) {
      setStatus('Invalid JSON: ' + err.message, 'err');
    }
  });

  /* ================================================================ */
  /*  Clear all data                                                  */
  /* ================================================================ */

  $('btn-clear').addEventListener('click', async () => {
    if (!confirm('This will erase ALL extension data including campaigns, settings, and usage history. Continue?')) {
      return;
    }

    try {
      await chrome.storage.local.clear();
      setStatus('All data cleared. Reload to apply defaults.', 'ok');
      await loadConfig();
    } catch (err) {
      setStatus('Failed to clear: ' + err.message, 'err');
    }
  });

  /* ================================================================ */
  /*  Version                                                         */
  /* ================================================================ */

  const manifest = chrome.runtime.getManifest();
  $('version').textContent = `LinkedIn Toolkit v${manifest.version}`;

  /* ================================================================ */
  /*  Boot                                                            */
  /* ================================================================ */

  loadConfig();
})();
