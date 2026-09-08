/**
 * LinkedIn Toolkit — Popup Controller
 *
 * Wires up the popup UI to background service worker message handlers.
 */

(function () {
  'use strict';

  /* ================================================================ */
  /*  Helpers                                                         */
  /* ================================================================ */

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

  function setStatus(id, text, type) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'status';
    if (type) el.classList.add(`status--${type}`);
  }

  /* ================================================================ */
  /*  Section toggles                                                 */
  /* ================================================================ */

  document.querySelectorAll('.section-header[data-toggle]').forEach((header) => {
    header.addEventListener('click', () => {
      const section = document.getElementById(header.dataset.toggle);
      if (section) section.classList.toggle('collapsed');
    });
  });

  /* ================================================================ */
  /*  Mass Unfollow                                                   */
  /* ================================================================ */

  $('btn-unfollow-count').addEventListener('click', async () => {
    const btn = $('btn-unfollow-count');
    btn.disabled = true;
    setStatus('unfollow-status', 'Checking...', 'busy');

    try {
      const result = await send({ type: 'UNFOLLOW_COUNT' });
      setStatus('unfollow-status', `Found ${result.count} people you're following.`, 'ok');
    } catch (err) {
      setStatus('unfollow-status', err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  $('btn-unfollow-all').addEventListener('click', async () => {
    if (!confirm('This will unfollow everyone on your following list. Are you sure?')) return;

    const btn = $('btn-unfollow-all');
    btn.disabled = true;

    const progressWrap = $('unfollow-progress');
    progressWrap.classList.add('active');
    $('unfollow-text').textContent = 'Starting...';
    $('unfollow-bar').style.width = '0%';

    setStatus('unfollow-status', 'Unfollowing in progress...', 'busy');

    try {
      const result = await send({ type: 'UNFOLLOW_ALL' });
      setStatus(
        'unfollow-status',
        `Done! Unfollowed ${result.unfollowed} people. Errors: ${result.errors}.`,
        'ok'
      );
      $('unfollow-bar').style.width = '100%';
      $('unfollow-text').textContent = `Completed: ${result.unfollowed} unfollowed`;
    } catch (err) {
      setStatus('unfollow-status', err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  // Listen for progress updates
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'UNFOLLOW_PROGRESS') {
      const total = msg.unfollowed + msg.remaining;
      const pct = total > 0 ? Math.round((msg.unfollowed / total) * 100) : 0;
      $('unfollow-bar').style.width = `${pct}%`;
      $('unfollow-text').textContent = `Unfollowed: ${msg.unfollowed} | Remaining: ${msg.remaining} | Errors: ${msg.errors}`;
    }
  });

  /* ================================================================ */
  /*  Profile Export                                                  */
  /* ================================================================ */

  $('btn-export-profile').addEventListener('click', async () => {
    const btn = $('btn-export-profile');
    btn.disabled = true;
    setStatus('profile-status', 'Fetching profile...', 'busy');

    try {
      const profile = await send({ type: 'EXPORT_PROFILE' });

      // Download as JSON
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${profile.publicIdentifier || 'profile'}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus('profile-status', `Exported: ${profile.fullName}`, 'ok');
    } catch (err) {
      setStatus('profile-status', err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  /* ================================================================ */
  /*  Search & Export                                                  */
  /* ================================================================ */

  $('btn-search-export').addEventListener('click', async () => {
    const keywords = $('search-keywords').value.trim();
    const count = parseInt($('search-count').value, 10) || 25;

    if (!keywords) {
      setStatus('search-status', 'Enter search keywords.', 'err');
      return;
    }

    const btn = $('btn-search-export');
    btn.disabled = true;
    setStatus('search-status', `Searching for "${keywords}"...`, 'busy');

    try {
      const profiles = await send({ type: 'SEARCH_EXPORT', keywords, count });

      if (!profiles || profiles.length === 0) {
        setStatus('search-status', 'No results found.', 'err');
        return;
      }

      setStatus('search-status', `Found ${profiles.length} results. Downloading CSV...`, 'busy');
      const result = await send({ type: 'DOWNLOAD_CSV', profiles });
      setStatus('search-status', `Exported ${result.count} profiles to ${result.filename}`, 'ok');
    } catch (err) {
      setStatus('search-status', err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  /* ================================================================ */
  /*  Campaign Manager                                                */
  /* ================================================================ */

  const campaignSteps = [];

  // Show/hide message template textarea based on step type
  $('step-type').addEventListener('change', () => {
    const type = $('step-type').value;
    $('step-message-wrap').style.display =
      (type === 'send_invite' || type === 'send_message') ? 'block' : 'none';
  });

  function renderSteps() {
    const list = $('steps-list');
    list.innerHTML = '';
    campaignSteps.forEach((step, i) => {
      const typeLabels = {
        view_profile: 'View',
        send_invite: 'Invite',
        send_message: 'Message',
        wait: 'Wait',
      };
      const div = document.createElement('div');
      div.className = 'step-item';
      div.innerHTML = `
        <span>${i + 1}.</span>
        <span class="step-item__badge">${typeLabels[step.type] || step.type}</span>
        <span>${step.delay_hours}h delay</span>
        <span class="step-item__remove" data-index="${i}" title="Remove step">&times;</span>
      `;
      list.appendChild(div);
    });

    // Bind remove buttons
    list.querySelectorAll('.step-item__remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        campaignSteps.splice(parseInt(btn.dataset.index, 10), 1);
        renderSteps();
      });
    });
  }

  $('btn-add-step').addEventListener('click', () => {
    const type = $('step-type').value;
    const delayHours = parseInt($('step-delay').value, 10) || 0;
    const messageTemplate = $('step-message').value.trim();

    campaignSteps.push({
      type,
      delay_hours: delayHours,
      message_template: (type === 'send_invite' || type === 'send_message') ? messageTemplate : '',
    });

    renderSteps();
    $('step-message').value = '';
  });

  $('btn-create-campaign').addEventListener('click', async () => {
    const name = $('camp-name').value.trim();
    if (!name) {
      setStatus('campaign-status', 'Enter a campaign name.', 'err');
      return;
    }
    if (campaignSteps.length === 0) {
      setStatus('campaign-status', 'Add at least one step.', 'err');
      return;
    }

    const btn = $('btn-create-campaign');
    btn.disabled = true;
    setStatus('campaign-status', 'Creating campaign...', 'busy');

    try {
      await send({
        type: 'CREATE_CAMPAIGN',
        name,
        steps: [...campaignSteps],
        contacts: [], // contacts are added later via search+select
      });

      campaignSteps.length = 0;
      renderSteps();
      $('camp-name').value = '';

      setStatus('campaign-status', `Campaign "${name}" created.`, 'ok');
      loadCampaigns();
    } catch (err) {
      setStatus('campaign-status', err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  async function loadCampaigns() {
    try {
      const campaigns = await send({ type: 'GET_CAMPAIGNS' });
      const list = $('campaign-list');
      list.innerHTML = '';

      if (!campaigns || campaigns.length === 0) {
        list.innerHTML = '<div style="font-size:11px;color:#999;padding:8px 0;">No campaigns yet.</div>';
        return;
      }

      campaigns.forEach((camp) => {
        const div = document.createElement('div');
        div.className = 'campaign-item';

        const contactCount = (camp.contacts || []).length;
        const completedContacts = (camp.contacts || []).filter(
          (c) => c.currentStep >= (camp.steps || []).length
        ).length;

        div.innerHTML = `
          <span class="campaign-item__name">${camp.name} <span style="font-weight:400;font-size:10px;color:#999;">(${completedContacts}/${contactCount})</span></span>
          <span class="campaign-item__status campaign-item__status--${camp.status}">${camp.status}</span>
          <div class="campaign-item__actions">
            ${camp.status === 'active'
              ? `<button class="btn btn-secondary btn-sm" data-action="pause" data-id="${camp.id}">Pause</button>`
              : camp.status === 'paused'
                ? `<button class="btn btn-primary btn-sm" data-action="resume" data-id="${camp.id}">Resume</button>`
                : ''
            }
            <button class="btn btn-danger btn-sm" data-action="delete" data-id="${camp.id}">Del</button>
          </div>
        `;

        list.appendChild(div);
      });

      // Bind campaign action buttons
      list.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          const id = btn.dataset.id;

          try {
            if (action === 'pause') {
              await send({ type: 'UPDATE_CAMPAIGN_STATUS', campaignId: id, status: 'paused' });
            } else if (action === 'resume') {
              await send({ type: 'UPDATE_CAMPAIGN_STATUS', campaignId: id, status: 'active' });
            } else if (action === 'delete') {
              if (!confirm('Delete this campaign?')) return;
              await send({ type: 'DELETE_CAMPAIGN', campaignId: id });
            }
            loadCampaigns();
          } catch (err) {
            setStatus('campaign-status', err.message, 'err');
          }
        });
      });
    } catch (err) {
      console.error('Failed to load campaigns:', err);
    }
  }

  /* ================================================================ */
  /*  Quick Actions                                                   */
  /* ================================================================ */

  $('btn-send-invite').addEventListener('click', async () => {
    setStatus('quick-status', 'Sending invite...', 'busy');
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tabs[0]?.url || '';
      const match = url.match(/linkedin\.com\/in\/([^/?#]+)/);
      if (!match) {
        setStatus('quick-status', 'Navigate to a LinkedIn profile first.', 'err');
        return;
      }
      await send({ type: 'SEND_INVITE', publicIdentifier: match[1] });
      setStatus('quick-status', 'Invite sent!', 'ok');
    } catch (err) {
      setStatus('quick-status', err.message, 'err');
    }
  });

  $('btn-send-message').addEventListener('click', async () => {
    const body = prompt('Enter your message:');
    if (!body) return;

    setStatus('quick-status', 'Sending message...', 'busy');
    try {
      // Need to get the profile URN first
      const profile = await send({ type: 'EXPORT_PROFILE' });
      if (!profile.profileUrn) {
        setStatus('quick-status', 'Could not resolve profile URN.', 'err');
        return;
      }
      await send({ type: 'SEND_MESSAGE', recipientUrn: profile.profileUrn, body });
      setStatus('quick-status', 'Message sent!', 'ok');
    } catch (err) {
      setStatus('quick-status', err.message, 'err');
    }
  });

  /* ================================================================ */
  /*  Settings                                                        */
  /* ================================================================ */

  const settingsMap = {
    'cfg-minDelay': { key: 'minDelayMs', display: 'val-min-delay', suffix: 's', divisor: 1000 },
    'cfg-maxDelay': { key: 'maxDelayMs', display: 'val-max-delay', suffix: 's', divisor: 1000 },
    'cfg-maxPerHour': { key: 'maxPerHour', display: 'val-max-hour' },
    'cfg-windowStartHour': { key: 'windowStartHour', display: 'val-start-hour' },
    'cfg-windowEndHour': { key: 'windowEndHour', display: 'val-end-hour' },
    'cfg-maxInvitesPerDay': { key: 'maxInvitesPerDay', display: 'val-max-invites' },
    'cfg-maxMessagesPerDay': { key: 'maxMessagesPerDay', display: 'val-max-messages' },
  };

  // Live display update for range inputs
  Object.entries(settingsMap).forEach(([inputId, meta]) => {
    const input = $(inputId);
    if (!input || input.type !== 'range') return;

    input.addEventListener('input', () => {
      const displayEl = $(meta.display);
      if (!displayEl) return;
      const val = meta.divisor ? (parseInt(input.value, 10) / meta.divisor) : parseInt(input.value, 10);
      displayEl.textContent = val + (meta.suffix || '');
    });
  });

  async function loadSettings() {
    try {
      const config = await send({ type: 'GET_CONFIG' });

      Object.entries(settingsMap).forEach(([inputId, meta]) => {
        const input = $(inputId);
        if (!input) return;
        input.value = config[meta.key];

        const displayEl = $(meta.display);
        if (displayEl) {
          const val = meta.divisor ? (config[meta.key] / meta.divisor) : config[meta.key];
          displayEl.textContent = val + (meta.suffix || '');
        }
      });

      $('cfg-windowWeekdaysOnly').checked = config.windowWeekdaysOnly;
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  $('btn-save-settings').addEventListener('click', async () => {
    const config = {};

    Object.entries(settingsMap).forEach(([inputId, meta]) => {
      const input = $(inputId);
      if (!input) return;
      config[meta.key] = parseInt(input.value, 10);
    });

    config.windowWeekdaysOnly = $('cfg-windowWeekdaysOnly').checked;

    try {
      await send({ type: 'SET_CONFIG', config });
      setStatus('settings-status', 'Settings saved.', 'ok');
    } catch (err) {
      setStatus('settings-status', err.message, 'err');
    }
  });

  /* ================================================================ */
  /*  Usage stats                                                     */
  /* ================================================================ */

  async function loadUsage() {
    try {
      const usage = await send({ type: 'GET_USAGE' });
      const quotas = await send({ type: 'GET_QUOTAS' });

      $('usage-stats').textContent =
        `Today: ${usage.action?.daily || 0} actions | ` +
        `${usage.invite?.daily || 0}/${quotas.maxInvitesPerDay} invites | ` +
        `${usage.message?.daily || 0}/${quotas.maxMessagesPerDay} messages`;
    } catch (err) {
      $('usage-stats').textContent = '';
    }
  }

  /* ================================================================ */
  /*  Boot                                                            */
  /* ================================================================ */

  async function boot() {
    await loadSettings();
    await loadCampaigns();
    await loadUsage();
  }

  boot();
})();
