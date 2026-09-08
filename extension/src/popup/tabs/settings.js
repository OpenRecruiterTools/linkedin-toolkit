/** Settings tab — placeholder until Task C6. */

import { render } from '../../ui/dom.js';
import { empty } from '../../ui/components.js';

export const id = 'settings';
export const label = 'Settings';

export async function mount(container) {
  render(container, empty('Settings land in Task C6.'));
}
