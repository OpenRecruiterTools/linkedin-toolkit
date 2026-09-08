/** Lists tab — placeholder until Task C3. */

import { render } from '../../ui/dom.js';
import { empty } from '../../ui/components.js';

export const id = 'lists';
export const label = 'Lists';

export async function mount(container) {
  render(container, empty('Lists land in Task C3.'));
}
