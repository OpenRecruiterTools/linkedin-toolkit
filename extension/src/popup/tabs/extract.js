/** Extract tab — placeholder until Task C2. */

import { render } from '../../ui/dom.js';
import { empty } from '../../ui/components.js';

export const id = 'extract';
export const label = 'Extract';

export async function mount(container) {
  render(container, empty('Extraction tools land in Task C2.'));
}
