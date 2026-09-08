/** Settings tab — the shared settings form, popup width. */

import { el } from '../../ui/dom.js';
import { renderSettings } from '../../ui/settings.js';
import { button } from '../../ui/components.js';

export const id = 'settings';
export const label = 'Settings';

export async function mount(container, ctx) {
  await renderSettings(container, {
    onSaved: () => (ctx && ctx.refreshHeader ? ctx.refreshHeader() : undefined),
  });
  container.appendChild(
    el(
      'p',
      { class: 'hint' },
      'Import, export and the danger zone live on the options page. ',
      button(
        'Open options',
        () => {
          if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
        },
        { variant: 'link' },
      ),
    ),
  );
}
