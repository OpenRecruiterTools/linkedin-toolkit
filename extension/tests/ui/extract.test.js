/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import * as extract from '../../src/popup/tabs/extract.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint, profileFixture, listFixture } from './helpers.js';

const cardOf = (host, key) => host.querySelector(`.extract-${key}`);
const runButton = (cardNode, label = 'Run') =>
  [...cardNode.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label));

function setValue(node, value) {
  node.value = value;
  node.dispatchEvent(new window.Event('input', { bubbles: true }));
  node.dispatchEvent(new window.Event('change', { bubbles: true }));
}

describe('Extract tab', () => {
  it('renders one card per contract extraction action', async () => {
    stubEngine({ [ACTIONS.LIST_GET_ALL]: { lists: [] } });
    const host = mountPoint();

    await extract.mount(host);

    const titles = [...host.querySelectorAll('.card-title')].map((n) => n.textContent);
    expect(titles).toEqual([
      'People search',
      'Profile export',
      'Post engagers',
      'Group members',
      'Event attendees',
      'Company',
      'My connections',
      'My followers',
      'Inbox export',
      'Mass unfollow',
    ]);
    expect(extract.CARDS.map((c) => c.action)).toEqual([
      ACTIONS.SEARCH_PEOPLE,
      ACTIONS.PROFILE_EXPORT,
      ACTIONS.POST_ENGAGERS,
      ACTIONS.GROUP_MEMBERS,
      ACTIONS.EVENT_ATTENDEES,
      ACTIONS.COMPANY_GET,
      ACTIONS.NETWORK_CONNECTIONS,
      ACTIONS.NETWORK_FOLLOWERS,
      ACTIONS.INBOX_EXPORT,
    ]);
  });

  it('runs search.people and follows nextStart across pages', async () => {
    const engine = stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.SEARCH_PEOPLE]: (params) => ({
        profiles: [profileFixture(`p${params.start || 0}`)],
        nextStart: (params.start || 0) + 25,
      }),
    });
    const host = mountPoint();
    await extract.mount(host);

    const node = cardOf(host, 'search');
    const [keywords] = node.querySelectorAll('input.input');
    setValue(keywords, 'head of talent');
    const numbers = [...node.querySelectorAll('input[type="number"]')];
    setValue(numbers[0], '25');
    setValue(numbers[1], '2');

    runButton(node).click();
    await flush(12);

    const calls = engine.allParamsFor(ACTIONS.SEARCH_PEOPLE);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ keywords: 'head of talent', source: 'search', count: 25 });
    expect(calls[1].start).toBe(25);
    expect(node.textContent).toContain('2 results');
  });

  it('clamps count to the contract ceiling of 100', async () => {
    const engine = stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.SEARCH_PEOPLE]: { profiles: [], nextStart: null },
    });
    const host = mountPoint();
    await extract.mount(host);

    const node = cardOf(host, 'search');
    setValue(node.querySelector('input.input'), 'cto');
    setValue(node.querySelectorAll('input[type="number"]')[0], '5000');

    runButton(node).click();
    await flush(10);

    expect(engine.paramsFor(ACTIONS.SEARCH_PEOPLE).count).toBe(100);
  });

  it('refuses to run without a required field', async () => {
    const engine = stubEngine({ [ACTIONS.LIST_GET_ALL]: { lists: [] } });
    const host = mountPoint();
    await extract.mount(host);

    runButton(cardOf(host, 'search')).click();
    await flush(6);

    expect(engine.countOf(ACTIONS.SEARCH_PEOPLE)).toBe(0);
    expect(cardOf(host, 'search').querySelector('.err').textContent).toContain('required');
  });

  it('batches profile.export in tens', async () => {
    const engine = stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.PROFILE_EXPORT]: (params) => ({
        profiles: params.urls.map((u) => profileFixture(u.split('/').pop())),
        failed: [],
      }),
    });
    const host = mountPoint();
    await extract.mount(host);

    const node = cardOf(host, 'profiles');
    const urls = Array.from(
      { length: 12 },
      (_, i) => `https://www.linkedin.com/in/person${i}`,
    ).join('\n');
    setValue(node.querySelector('textarea'), urls);
    node.querySelector('input[type="checkbox"]').checked = true;

    runButton(node, 'Export profiles').click();
    await flush(14);

    const calls = engine.allParamsFor(ACTIONS.PROFILE_EXPORT);
    expect(calls).toHaveLength(2);
    expect(calls[0].urls).toHaveLength(10);
    expect(calls[1].urls).toHaveLength(2);
    expect(calls[0].full).toBe(true);
    expect(node.textContent).toContain('12 results');
  });

  it('reads a universal name out of a full company URL', async () => {
    const engine = stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.COMPANY_GET]: { universalName: 'acme', name: 'Acme' },
    });
    const host = mountPoint();
    await extract.mount(host);

    const node = cardOf(host, 'company');
    setValue(node.querySelector('input.input'), 'https://www.linkedin.com/company/acme/');
    runButton(node, 'Get company').click();
    await flush(10);

    expect(engine.paramsFor(ACTIONS.COMPANY_GET)).toEqual({ universalName: 'acme' });
  });

  it('saves results into an existing list', async () => {
    const engine = stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [listFixture()] },
      [ACTIONS.NETWORK_CONNECTIONS]: { profiles: [profileFixture('ada')], nextStart: null },
      [ACTIONS.LIST_ADD]: { added: 1, duplicates: 0 },
    });
    const host = mountPoint();
    await extract.mount(host);

    const node = cardOf(host, 'connections');
    runButton(node).click();
    await flush(10);

    const listSelect = node.querySelector('select');
    setValue(listSelect, 'l1');
    [...node.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Save to list'))
      .click();
    await flush(8);

    const params = engine.paramsFor(ACTIONS.LIST_ADD);
    expect(params.listId).toBe('l1');
    expect(params.profiles).toHaveLength(1);
    expect(params.profiles[0].publicId).toBe('ada');
  });

  it('creates a list first when "New list" is chosen', async () => {
    const engine = stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.NETWORK_FOLLOWERS]: { profiles: [profileFixture('ada')], nextStart: null },
      [ACTIONS.LIST_CREATE]: listFixture({ listId: 'new1', name: 'Fresh' }),
      [ACTIONS.LIST_ADD]: { added: 1, duplicates: 0 },
    });
    const host = mountPoint();
    await extract.mount(host);

    const node = cardOf(host, 'followers');
    runButton(node).click();
    await flush(10);

    setValue(node.querySelector('select'), '__new__');
    const nameInput = [...node.querySelectorAll('input.input')].find(
      (i) => i.placeholder === 'New list name',
    );
    expect(nameInput.hidden).toBe(false);
    setValue(nameInput, 'Fresh');
    [...node.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Save to list'))
      .click();
    await flush(10);

    expect(engine.paramsFor(ACTIONS.LIST_CREATE)).toEqual({ name: 'Fresh' });
    expect(engine.paramsFor(ACTIONS.LIST_ADD).listId).toBe('new1');
  });

  it('downloads a CSV built in the popup', async () => {
    stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.NETWORK_CONNECTIONS]: { profiles: [profileFixture('ada')], nextStart: null },
    });
    const host = mountPoint();
    await extract.mount(host);

    const node = cardOf(host, 'connections');
    runButton(node).click();
    await flush(10);

    [...node.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Download CSV'))
      .click();
    await flush(6);

    const downloads = chrome.__mock.downloads;
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toMatch(/^connections-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = decodeURIComponent(downloads[0].url.replace(/^data:text\/csv;charset=utf-8,/, ''));
    expect(csv.split('\n')[0]).toContain('fullName');
    expect(csv).toContain('Ada Lovelace');
  });

  it('offers no "save to list" for the inbox export', async () => {
    stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.INBOX_EXPORT]: { threads: [{ threadId: 't1' }], messages: [] },
    });
    const host = mountPoint();
    await extract.mount(host);

    const node = cardOf(host, 'inbox');
    runButton(node).click();
    await flush(8);

    expect(node.textContent).toContain('1 result');
    expect(
      [...node.querySelectorAll('button')].some((b) => b.textContent.includes('Save to list')),
    ).toBe(false);
  });

  it('shows the engine error inline instead of throwing', async () => {
    stubEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [] },
      [ACTIONS.NETWORK_CONNECTIONS]: {
        ok: false,
        error: { code: 'NOT_LOGGED_IN', message: 'sign in first', howToFix: 'open linkedin.com' },
      },
    });
    const host = mountPoint();
    await extract.mount(host);

    runButton(cardOf(host, 'connections')).click();
    await flush(8);

    const err = cardOf(host, 'connections').querySelector('.err');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe('sign in first open linkedin.com (NOT_LOGGED_IN)');
  });
});
