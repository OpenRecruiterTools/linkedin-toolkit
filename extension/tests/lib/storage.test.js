import { describe, it, expect } from 'vitest';
import * as storage from '../../src/lib/storage.js';

describe('storage keys', () => {
  it('exposes the contract storage keys', () => {
    expect(storage.K.LISTS).toBe('lists');
    expect(storage.K.QUEUE).toBe('queue');
    expect(storage.K.CAMPAIGNS).toBe('campaigns');
    expect(storage.K.ACTIONS).toBe('actions');
    expect(storage.K.RESEARCH_JOBS).toBe('researchJobs');
    expect(storage.K.listMembers('l1')).toBe('listMembers:l1');
    expect(storage.K.enrollments('c1')).toBe('enrollments:c1');
    expect(storage.K.researchPacks('j1')).toBe('researchPacks:j1');
  });
});

describe('get/set/update', () => {
  it('round-trips a value and honours the fallback', async () => {
    expect(await storage.get('nope', { a: 1 })).toEqual({ a: 1 });
    await storage.set('nope', [1, 2]);
    expect(await storage.get('nope', null)).toEqual([1, 2]);
    await storage.remove('nope');
    expect(await storage.get('nope', null)).toBe(null);
  });

  it('update applies a function to the current value', async () => {
    await storage.update('counter', (n) => (n || 0) + 1, 0);
    await storage.update('counter', (n) => n + 1, 0);
    expect(await storage.get('counter', 0)).toBe(2);
  });
});

describe('ids and stamps', () => {
  it('newId is prefixed and unique', () => {
    const a = storage.newId('q');
    const b = storage.newId('q');
    expect(a.startsWith('q_')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('stamp adds updatedAt without mutating the input', () => {
    const input = { a: 1 };
    const out = storage.stamp(input);
    expect(typeof out.updatedAt).toBe('number');
    expect(input.updatedAt).toBeUndefined();
  });
});

describe('profile store', () => {
  it('stores, reads back and lists profiles with updatedAt', async () => {
    await storage.putProfile({ publicId: 'ada', fullName: 'Ada Lovelace' });
    await storage.putProfile({ publicId: 'bob', fullName: 'Bob' });
    const ada = await storage.getStoredProfile('ada');
    expect(ada.fullName).toBe('Ada Lovelace');
    expect(typeof ada.updatedAt).toBe('number');
    const all = await storage.allProfiles();
    expect(all.map((p) => p.publicId).sort()).toEqual(['ada', 'bob']);
  });

  it('merges on re-put and keeps the union of fields', async () => {
    await storage.putProfile({ publicId: 'ada', fullName: 'Ada', headline: 'Maths' });
    await storage.putProfile({ publicId: 'ada', company: 'Analytical Engines' });
    const ada = await storage.getStoredProfile('ada');
    expect(ada.headline).toBe('Maths');
    expect(ada.company).toBe('Analytical Engines');
  });

  it('never lets a sparse record erase what we already knew', async () => {
    await storage.putProfile({
      publicId: 'ada',
      urn: 'urn:li:fsd_profile:ACoAAAada',
      company: 'Analytical Engines',
      skills: ['Maths'],
      headline: 'Chief Analyst',
    });

    // A search hit carries empty strings and empty arrays for everything it
    // does not know; spreading it over the record would blank the urn we paid
    // a profile view for.
    await storage.putProfile({
      publicId: 'ada',
      urn: '',
      company: '',
      skills: [],
      location: 'London',
    });

    const ada = await storage.getStoredProfile('ada');
    expect(ada.urn).toBe('urn:li:fsd_profile:ACoAAAada');
    expect(ada.company).toBe('Analytical Engines');
    expect(ada.skills).toEqual(['Maths']);
    expect(ada.location).toBe('London');
  });

  it('lets an explicit unknown clear a stale value', async () => {
    // `undefined` means "this record does not carry the field"; `null` means
    // "we looked and could not tell", and that has to win — otherwise a degree
    // nobody has checked survives the read that failed to confirm it.
    await storage.putProfile({ publicId: 'ada', connectionDegree: 1 });
    await storage.putProfile({ publicId: 'ada', connectionDegree: null });
    expect((await storage.getStoredProfile('ada')).connectionDegree).toBe(null);

    await storage.putProfile({ publicId: 'ada', connectionDegree: 2 });
    await storage.putProfile({ publicId: 'ada', company: 'Somewhere' });
    expect((await storage.getStoredProfile('ada')).connectionDegree).toBe(2);
  });

  it('still lets a real value replace an old one', async () => {
    await storage.putProfile({ publicId: 'ada', company: 'Old Co' });
    await storage.putProfile({ publicId: 'ada', company: 'Analytical Engines' });
    expect((await storage.getStoredProfile('ada')).company).toBe('Analytical Engines');
  });

  it('truncates very large pageText', async () => {
    await storage.putProfile({ publicId: 'big', pageText: 'x'.repeat(120000) });
    const rec = await storage.getStoredProfile('big');
    expect(rec.pageText.length).toBeLessThanOrEqual(storage.MAX_PAGE_TEXT);
  });

  it('profilesSince filters on updatedAt', async () => {
    await storage.putProfile({ publicId: 'old', updatedAt: 1 });
    const cutoff = Date.now();
    await storage.putProfile({ publicId: 'new' });
    const since = await storage.profilesSince(cutoff - 1);
    expect(since.map((p) => p.publicId)).toEqual(['new']);
  });
});

describe('action log', () => {
  it('logs entries with id/at and reports contactedBefore', async () => {
    expect(await storage.contactedBefore('ada')).toBe(false);
    const entry = await storage.logAction({
      action: 'outreach.invite',
      publicId: 'ada',
      origin: 'popup',
      result: { status: 'sent' },
    });
    expect(entry.id).toBeTruthy();
    expect(typeof entry.at).toBe('number');
    expect(await storage.contactedBefore('ada')).toBe(true);
    expect(await storage.contactedBefore('bob')).toBe(false);
  });

  it('does not count a view or a follow as contact', async () => {
    await storage.logAction({ action: 'outreach.view', publicId: 'zoe', origin: 'popup' });
    expect(await storage.contactedBefore('zoe')).toBe(false);
  });

  it('actionsSince filters on at', async () => {
    await storage.logAction({ action: 'outreach.invite', publicId: 'a', at: 5 });
    await storage.logAction({ action: 'outreach.invite', publicId: 'b' });
    const recent = await storage.actionsSince(1000);
    expect(recent.map((e) => e.publicId)).toEqual(['b']);
  });
});
