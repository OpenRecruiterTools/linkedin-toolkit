import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import * as lists from '../../src/background/lists.js';
import * as storage from '../../src/lib/storage.js';

const NOW = new Date(2026, 8, 9, 11, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const ada = {
  publicId: 'adalovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  fullName: 'Ada Lovelace',
  company: 'Analytical Engines',
  title: 'Chief Analyst',
  url: 'https://www.linkedin.com/in/adalovelace/',
};
const bob = { publicId: 'bobbright', fullName: 'Bob Bright', company: 'Beta Systems' };

async function newList(name = 'Targets', tags = []) {
  const res = await handle(ACTIONS.LIST_CREATE, { name, tags });
  return res.data;
}

describe('list.create / getAll / get / delete', () => {
  it('creates a list with an id, tags and a count', async () => {
    const list = await newList('Founders', ['company:Analytical Engines']);
    expect(list.listId).toMatch(/^list_/);
    expect(list).toMatchObject({ name: 'Founders', tags: ['company:Analytical Engines'], count: 0 });
    expect(typeof list.createdAt).toBe('number');
    expect(typeof list.updatedAt).toBe('number');
  });

  it('lists them all and fetches one', async () => {
    const a = await newList('A');
    await newList('B');
    expect((await handle(ACTIONS.LIST_GET_ALL, {})).data.lists).toHaveLength(2);
    expect((await handle(ACTIONS.LIST_GET, { listId: a.listId })).data.name).toBe('A');
  });

  it('404s an unknown list', async () => {
    const res = await handle(ACTIONS.LIST_GET, { listId: 'nope' });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('deletes the list and its members', async () => {
    const list = await newList();
    await handle(ACTIONS.LIST_ADD, { listId: list.listId, profiles: [ada] });
    expect((await handle(ACTIONS.LIST_DELETE, { listId: list.listId })).data).toEqual({ ok: true });
    expect((await handle(ACTIONS.LIST_GET_ALL, {})).data.lists).toHaveLength(0);
    expect(await storage.get(storage.K.listMembers(list.listId), null)).toBe(null);
  });
});

describe('list.add dedupe', () => {
  it('dedupes on publicId across calls and within one call', async () => {
    const list = await newList();
    const first = await handle(ACTIONS.LIST_ADD, {
      listId: list.listId,
      profiles: [ada, bob, { ...ada, title: 'Chief' }],
    });
    expect(first.data).toEqual({ added: 2, duplicates: 1 });

    const second = await handle(ACTIONS.LIST_ADD, { listId: list.listId, profiles: [ada] });
    expect(second.data).toEqual({ added: 0, duplicates: 1 });

    expect((await handle(ACTIONS.LIST_GET, { listId: list.listId })).data.count).toBe(2);
  });

  it('accepts bare publicIds and back-fills from the profile store', async () => {
    await storage.putProfile(ada);
    const list = await newList();
    await handle(ACTIONS.LIST_ADD, { listId: list.listId, publicIds: ['adalovelace', 'unknown'] });
    const { members } = (await handle(ACTIONS.LIST_MEMBERS, { listId: list.listId })).data;
    const stored = members.find((m) => m.publicId === 'adalovelace');
    expect(stored.profile.company).toBe('Analytical Engines');
    expect(members.find((m) => m.publicId === 'unknown').profile.publicId).toBe('unknown');
  });

  it('removes members', async () => {
    const list = await newList();
    await handle(ACTIONS.LIST_ADD, { listId: list.listId, profiles: [ada, bob] });
    expect(
      (await handle(ACTIONS.LIST_REMOVE, { listId: list.listId, publicIds: ['bobbright', 'x'] }))
        .data,
    ).toEqual({ removed: 1 });
    expect((await handle(ACTIONS.LIST_GET, { listId: list.listId })).data.count).toBe(1);
  });

  it('paginates members and reports the total', async () => {
    const list = await newList();
    await handle(ACTIONS.LIST_ADD, { listId: list.listId, profiles: [ada, bob] });
    const page = (await handle(ACTIONS.LIST_MEMBERS, { listId: list.listId, start: 1, count: 1 }))
      .data;
    expect(page.total).toBe(2);
    expect(page.members).toHaveLength(1);
  });
});

describe('contactedBefore', () => {
  it('comes from the actions log, not from the member record', async () => {
    const list = await newList();
    await handle(ACTIONS.LIST_ADD, { listId: list.listId, profiles: [ada, bob] });

    let members = (await handle(ACTIONS.LIST_MEMBERS, { listId: list.listId })).data.members;
    expect(members.every((m) => m.contactedBefore === false)).toBe(true);

    await storage.logAction({ action: ACTIONS.OUTREACH_MESSAGE, publicId: 'adalovelace' });

    members = (await handle(ACTIONS.LIST_MEMBERS, { listId: list.listId })).data.members;
    expect(members.find((m) => m.publicId === 'adalovelace').contactedBefore).toBe(true);
    expect(members.find((m) => m.publicId === 'bobbright').contactedBefore).toBe(false);
  });
});

describe('signals', () => {
  it('changedJobRecently when the latest role started under 90 days ago', () => {
    const fresh = { ...ada, experience: [{ title: 'Chief', company: 'AE', start: Date.now() - 30 * DAY }] };
    const old = { ...ada, experience: [{ title: 'Chief', company: 'AE', start: Date.now() - 400 * DAY }] };
    expect(lists.computeSignals(fresh, [])).toContain('changedJobRecently');
    expect(lists.computeSignals(old, [])).not.toContain('changedJobRecently');
  });

  it('ignores an ended role when picking the latest one', () => {
    const p = {
      ...ada,
      experience: [
        { title: 'Old', company: 'X', start: Date.now() - 30 * DAY, end: Date.now() - 10 * DAY },
        { title: 'New', company: 'AE', start: Date.now() - 400 * DAY },
      ],
    };
    expect(lists.computeSignals(p, [])).not.toContain('changedJobRecently');
  });

  it('atTargetCompany when a company: tag on the list matches', () => {
    expect(lists.computeSignals(ada, ['company:analytical engines'])).toContain('atTargetCompany');
    expect(lists.computeSignals(ada, ['company:Beta Systems'])).not.toContain('atTargetCompany');
    expect(lists.computeSignals(ada, ['priority'])).not.toContain('atTargetCompany');
  });

  it('engagedWithPost when the post.engagers import flagged them', () => {
    expect(lists.computeSignals({ ...ada, engagedWithPost: true }, [])).toContain('engagedWithPost');
    expect(lists.computeSignals(ada, [])).not.toContain('engagedWithPost');
  });

  it('lands on the member records', async () => {
    const list = await newList('Targets', ['company:Analytical Engines']);
    await handle(ACTIONS.LIST_ADD, { listId: list.listId, profiles: [ada] });
    const { members } = (await handle(ACTIONS.LIST_MEMBERS, { listId: list.listId })).data;
    expect(members[0].signals).toContain('atTargetCompany');
  });
});

describe('list.importCsv', () => {
  it('maps the documented column names', async () => {
    const list = await newList();
    const csv = [
      'linkedin_url,first_name,last_name,company,title',
      'https://www.linkedin.com/in/adalovelace/,Ada,Lovelace,Analytical Engines,Chief Analyst',
    ].join('\n');
    const res = await handle(ACTIONS.LIST_IMPORT_CSV, { listId: list.listId, csv });
    expect(res.data).toEqual({ added: 1, duplicates: 0, invalid: 0 });

    const { members } = (await handle(ACTIONS.LIST_MEMBERS, { listId: list.listId })).data;
    expect(members[0].profile).toMatchObject({
      publicId: 'adalovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      fullName: 'Ada Lovelace',
      company: 'Analytical Engines',
      title: 'Chief Analyst',
    });
  });

  it('accepts url and profile as aliases for the link column', async () => {
    const a = await newList('a');
    expect(
      (
        await handle(ACTIONS.LIST_IMPORT_CSV, {
          listId: a.listId,
          csv: 'url\nhttps://www.linkedin.com/in/adalovelace/',
        })
      ).data.added,
    ).toBe(1);

    const b = await newList('b');
    expect(
      (
        await handle(ACTIONS.LIST_IMPORT_CSV, {
          listId: b.listId,
          csv: 'Profile\nhttps://www.linkedin.com/in/bobbright/',
        })
      ).data.added,
    ).toBe(1);
  });

  it('counts rows with no usable profile link as invalid', async () => {
    const list = await newList();
    const csv = 'linkedin_url,first_name\n,Nobody\nhttps://example.com/x,Someone';
    expect((await handle(ACTIONS.LIST_IMPORT_CSV, { listId: list.listId, csv })).data).toEqual({
      added: 0,
      duplicates: 0,
      invalid: 2,
    });
  });

  it('counts duplicates against what is already in the list', async () => {
    const list = await newList();
    await handle(ACTIONS.LIST_ADD, { listId: list.listId, profiles: [ada] });
    const csv = 'linkedin_url\nhttps://www.linkedin.com/in/adalovelace/';
    expect((await handle(ACTIONS.LIST_IMPORT_CSV, { listId: list.listId, csv })).data).toEqual({
      added: 0,
      duplicates: 1,
      invalid: 0,
    });
  });
});

describe('ensureList', () => {
  it('creates on first call and reuses the same list afterwards', async () => {
    const first = await lists.ensureList('Research Pack 2026-09-09');
    const second = await lists.ensureList('Research Pack 2026-09-09');
    expect(second.listId).toBe(first.listId);
    expect((await handle(ACTIONS.LIST_GET_ALL, {})).data.lists).toHaveLength(1);
  });
});
