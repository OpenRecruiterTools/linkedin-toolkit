/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import * as lists from '../../src/popup/tabs/lists.js';
import { ACTIONS } from '../../src/lib/actions.js';
import {
  stubEngine,
  flush,
  mountPoint,
  profileFixture,
  listFixture,
  campaignFixture,
} from './helpers.js';

const memberFixture = (publicId = 'ada', overrides = {}) => ({
  publicId,
  profile: profileFixture(publicId),
  addedAt: 1_757_000_000_000,
  tags: [],
  contactedBefore: false,
  signals: [],
  ...overrides,
});

function baseEngine(extra = {}) {
  return stubEngine({
    [ACTIONS.LIST_GET_ALL]: { lists: [listFixture()] },
    [ACTIONS.CAMPAIGN_GET_ALL]: { campaigns: [campaignFixture()] },
    [ACTIONS.LIST_MEMBERS]: {
      members: [
        memberFixture('ada', { signals: ['changed job'], contactedBefore: true, tags: ['warm'] }),
        memberFixture('grace'),
      ],
      total: 2,
    },
    ...extra,
  });
}

const clickLabelled = (host, text) => {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (!node) throw new Error(`no button "${text}"`);
  node.click();
  return node;
};

describe('Lists tab', () => {
  it('renders lists and the members of the first one with signal badges', async () => {
    baseEngine();
    const host = mountPoint();

    await lists.mount(host);

    expect(host.textContent).toContain('Founders');
    expect(host.textContent).toContain('Ada Lovelace');
    expect(host.textContent).toContain('changed job');
    expect(host.textContent).toContain('contacted before');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('creates a list and selects it', async () => {
    const engine = baseEngine({
      [ACTIONS.LIST_CREATE]: listFixture({ listId: 'l2', name: 'Berlin', count: 0 }),
      [ACTIONS.LIST_GET_ALL]: () => ({
        lists: [listFixture(), listFixture({ listId: 'l2', name: 'Berlin', count: 0 })],
      }),
    });
    const host = mountPoint();
    await lists.mount(host);

    const [name, tags] = host.querySelectorAll('.card input.input');
    name.value = 'Berlin';
    tags.value = 'founders, warm';
    clickLabelled(host, 'Create');
    await flush(12);

    expect(engine.paramsFor(ACTIONS.LIST_CREATE)).toEqual({
      name: 'Berlin',
      tags: ['founders', 'warm'],
    });
    expect(engine.paramsFor(ACTIONS.LIST_MEMBERS).listId).toBe('l2');
  });

  it('removes a member through list.remove', async () => {
    const engine = baseEngine({ [ACTIONS.LIST_REMOVE]: { removed: 1 } });
    const host = mountPoint();
    await lists.mount(host);

    host.querySelectorAll('tbody tr')[0].querySelector('button').click();
    await flush(12);

    expect(engine.paramsFor(ACTIONS.LIST_REMOVE)).toEqual({
      listId: 'l1',
      publicIds: ['ada'],
    });
  });

  it('enrols the ticked members into the chosen campaign', async () => {
    const engine = baseEngine({ [ACTIONS.CAMPAIGN_ENROLL]: { enrolled: 1, skipped: 0 } });
    const host = mountPoint();
    await lists.mount(host);

    host.querySelector('input[data-member="grace"]').checked = true;
    const campaignSelect = [...host.querySelectorAll('select')].pop();
    campaignSelect.value = 'c1';
    clickLabelled(host, 'Enrol');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.CAMPAIGN_ENROLL)).toEqual({
      campaignId: 'c1',
      publicIds: ['grace'],
    });
    expect(host.textContent).toContain('Enrolled 1');
  });

  it('enrols everyone when nothing is ticked', async () => {
    const engine = baseEngine({ [ACTIONS.CAMPAIGN_ENROLL]: { enrolled: 2, skipped: 0 } });
    const host = mountPoint();
    await lists.mount(host);

    [...host.querySelectorAll('select')].pop().value = 'c1';
    clickLabelled(host, 'Enrol');
    await flush(10);

    expect(engine.paramsFor(ACTIONS.CAMPAIGN_ENROLL).publicIds).toEqual(['ada', 'grace']);
  });

  it('imports a CSV file through list.importCsv', async () => {
    const engine = baseEngine({
      [ACTIONS.LIST_IMPORT_CSV]: { added: 3, duplicates: 1, invalid: 0 },
    });
    const host = mountPoint();
    await lists.mount(host);

    const fileInput = host.querySelector('input[type="file"]');
    const file = new window.File(['name,linkedin_url\nAda,https://x'], 'people.csv', {
      type: 'text/csv',
    });
    Object.defineProperty(fileInput, 'files', { value: [file] });

    clickLabelled(host, 'Import');
    await flush(14);

    expect(engine.paramsFor(ACTIONS.LIST_IMPORT_CSV).listId).toBe('l1');
    expect(engine.paramsFor(ACTIONS.LIST_IMPORT_CSV).csv).toContain('linkedin_url');
    expect(host.textContent).toContain('Imported 3');
  });

  it('exports the list through export.csv and downloads it', async () => {
    baseEngine({
      [ACTIONS.EXPORT_CSV]: { csv: 'fullName\nAda Lovelace', filename: 'founders.csv' },
    });
    const host = mountPoint();
    await lists.mount(host);

    clickLabelled(host, 'Export CSV');
    await flush(10);

    expect(chrome.__mock.downloads[0].filename).toBe('founders.csv');
  });

  it('asks before deleting a list, then calls list.delete', async () => {
    const engine = baseEngine({ [ACTIONS.LIST_DELETE]: { ok: true } });
    const host = mountPoint();
    await lists.mount(host);

    clickLabelled(host, 'Delete list');
    await flush(6);
    expect(engine.countOf(ACTIONS.LIST_DELETE)).toBe(0);

    document.querySelector('[data-testid="confirm-ok"]').click();
    await flush(12);

    expect(engine.paramsFor(ACTIONS.LIST_DELETE)).toEqual({ listId: 'l1' });
  });

  it('says so when there are no lists', async () => {
    stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.CAMPAIGN_GET_ALL]: { campaigns: [] },
    });
    const host = mountPoint();

    await lists.mount(host);

    expect(host.textContent).toContain('No lists yet');
  });
});
