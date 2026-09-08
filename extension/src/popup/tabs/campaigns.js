/** Campaigns tab — placeholder until Task C4. */

import { render } from '../../ui/dom.js';
import { empty } from '../../ui/components.js';

export const id = 'campaigns';
export const label = 'Campaigns';

export async function mount(container) {
  render(container, empty('The campaign builder lands in Task C4.'));
}
