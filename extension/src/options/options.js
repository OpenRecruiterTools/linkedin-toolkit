/**
 * Options page — the same settings module full-width, plus settings
 * import/export and a danger zone.
 */

import { el, render } from '../ui/dom.js';
import { call, send } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { renderSettings } from '../ui/settings.js';
import { card, row, busyButton, button, pill, confirmDialog } from '../ui/components.js';
import { downloadJson, today } from '../ui/download.js';
import { readTextFile } from '../ui/csv.js';

/** Import / export and the danger zone, appended under the settings form. */
export function extraCards(ctx) {
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'input' });

  return [
    card(
      'Settings file',
      { hint: 'A plain JSON copy of your configuration. It contains your API keys.' },
      row(
        busyButton(
          'Export settings',
          async () => {
            const config = await call(ACTIONS.CONFIG_GET, {});
            await downloadJson(`linkedin-toolkit-settings-${today()}.json`, config);
          },
          { error: ctx.error },
        ),
      ),
      row(
        fileInput,
        busyButton(
          'Import settings',
          async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) throw new Error('Choose a settings file first.');
            let parsed;
            try {
              parsed = JSON.parse(await readTextFile(file));
            } catch {
              throw new Error('That file is not valid JSON.');
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error('That file does not contain a settings object.');
            }
            await call(ACTIONS.CONFIG_SET, parsed);
            ctx.status.set('Imported. Reloading the form…');
            await ctx.reload();
          },
          { error: ctx.error },
        ),
      ),
    ),

    card(
      'Danger zone',
      {
        class: 'card--danger',
        hint: 'Lists, campaigns, the queue, captured profiles and every setting.',
      },
      busyButton(
        'Clear all data',
        async () => {
          const sure = await confirmDialog({
            title: 'Erase everything this extension has stored?',
            message:
              'Lists, campaigns, queued items, captured profiles and all settings go. ' +
              'Nothing on LinkedIn itself is touched, and nothing can be undone.',
            confirmLabel: 'Erase everything',
            typeToConfirm: 'ERASE',
            danger: true,
          });
          if (!sure) return;
          await chrome.storage.local.clear();
          ctx.status.set('Cleared. Reload the extension to start fresh.');
          await ctx.reload();
        },
        { variant: 'danger', error: ctx.error },
      ),
    ),
  ];
}

/** Paint the small connection summary in the page header. */
export async function paintHeader(host) {
  if (!host) return;
  const envelope = await send(ACTIONS.STATUS_GET, {});
  if (!envelope.ok) {
    render(host, pill('engine offline', 'bad'));
    return;
  }
  const status = envelope.data || {};
  render(host, [
    status.loggedIn ? pill('LinkedIn ✓', 'good') : pill('signed out', 'bad'),
    status.autopilot ? pill('Autopilot', 'warn') : pill('Copilot', 'info'),
  ]);
}

export async function start(nodes) {
  await paintHeader(nodes.headStatus);
  await renderSettings(nodes.view, { extras: extraCards });
  const backToPopup = el(
    'p',
    { class: 'hint' },
    button('Reload this page', () => window.location.reload(), { variant: 'link' }),
  );
  nodes.view.appendChild(backToPopup);
}

/* istanbul ignore next — browser bootstrap, exercised by the smoke checklist */
if (typeof document !== 'undefined' && document.getElementById('view')) {
  start({
    view: document.getElementById('view'),
    headStatus: document.getElementById('head-status'),
  });
}
