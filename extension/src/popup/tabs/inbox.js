/** Inbox tab — placeholder until Task C5. */

import { render } from '../../ui/dom.js';
import { empty } from '../../ui/components.js';

export const id = 'inbox';
export const label = 'Inbox';

export async function mount(container) {
  render(container, empty('The inbox lands in Task C5.'));
}
