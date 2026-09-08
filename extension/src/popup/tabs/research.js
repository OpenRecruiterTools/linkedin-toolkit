/** Research Pack tab — placeholder until Task C5b. */

import { render } from '../../ui/dom.js';
import { empty } from '../../ui/components.js';

export const id = 'research';
export const label = 'Research';

export async function mount(container) {
  render(container, empty('Research Packs land in Task C5b.'));
}
