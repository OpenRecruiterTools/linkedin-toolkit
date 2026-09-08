/** Queue tab — placeholder until Task C5. */

import { render } from '../../ui/dom.js';
import { empty } from '../../ui/components.js';

export const id = 'queue';
export const label = 'Queue';

export async function mount(container) {
  render(container, empty('The approval queue lands in Task C5.'));
}
