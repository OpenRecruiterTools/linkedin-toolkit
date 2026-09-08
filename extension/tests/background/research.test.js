import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as events from '../../src/background/events.js';
import * as enrich from '../../src/background/enrich.js';
import * as quota from '../../src/background/quota.js';
import * as research from '../../src/background/research.js';
import * as storage from '../../src/lib/storage.js';
import '../../src/background/outreach.js';
import { seedSession, stubFetch } from '../helpers/net.js';

import profileView from '../fixtures/voyager/profileView.json';
import searchClusters from '../fixtures/voyager/searchClusters.json';
import company from '../fixtures/voyager/company.json';
import memberPosts from '../fixtures/voyager/memberPosts.json';
import mutualConnections from '../fixtures/voyager/mutualConnections.json';

let net;
let seen;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 9, 11, 0, 0));
  quota.setSleepFn(() => Promise.resolve());
  seedSession();
  net = stubFetch();
  seen = [];
  events.setSink((f) => seen.push(f));
  await setConfig({ accountPreset: 'recruiter', businessHoursOnly: false });
});

afterEach(() => {
  events.setSink(null);
  vi.useRealTimers();
});

const names = () => seen.map((f) => f.event);

describe('name matching', () => {
  it('levenshtein and similarity behave', () => {
    expect(research.levenshtein('ada', 'ada')).toBe(0);
    expect(research.levenshtein('ada', 'adam')).toBe(1);
    expect(research.nameSimilarity('Ada Lovelace', 'ada lovelace')).toBe(1);
    expect(research.nameSimilarity('Ada Lovelace', 'Ada Lovelaces')).toBeGreaterThan(0.9);
    expect(research.nameSimilarity('Ada Lovelace', 'Bob Bright')).toBeLessThan(0.5);
    expect(research.nameSimilarity('', 'Ada')).toBe(0);
  });

  it('reads a domain from a domain column or an email', () => {
    expect(research.domainOf({ domain: 'https://www.analytical-engines.com/about' })).toBe(
      'analytical-engines.com',
    );
    expect(research.domainOf({ email: 'ada@analytical-engines.com' })).toBe(
      'analytical-engines.com',
    );
    expect(research.domainOf({})).toBe('');
  });

  it('derives a universalName from a domain', () => {
    expect(research.universalNameFromDomain('analytical-engines.com')).toBe('analytical-engines');
    expect(research.universalNameFromDomain('beta.co.uk')).toBe('beta-co');
  });
});

describe('research.resolve', () => {
  it('resolves a direct LinkedIn URL with full confidence and no network call', async () => {
    const res = await handle(ACTIONS.RESEARCH_RESOLVE, {
      rows: [{ linkedinUrl: 'https://www.linkedin.com/in/adalovelace/' }],
    });
    expect(res.data.resolved[0]).toMatchObject({
      kind: 'person',
      publicId: 'adalovelace',
      confidence: 1,
    });
    expect(net.calls).toHaveLength(0);
  });

  it('resolves a name plus company through search when both match', async () => {
    net.push(searchClusters);
    const res = await handle(ACTIONS.RESEARCH_RESOLVE, {
      rows: [{ name: 'Ada Lovelace', company: 'Analytical Engines' }],
    });
    expect(res.data.resolved[0]).toMatchObject({ kind: 'person', publicId: 'adalovelace' });
    expect(res.data.resolved[0].confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('returns candidates when the company does not match', async () => {
    net.push(searchClusters);
    const res = await handle(ACTIONS.RESEARCH_RESOLVE, {
      rows: [{ name: 'Ada Lovelace', company: 'A Completely Different Firm' }],
    });
    const row = res.data.resolved[0];
    expect(row.kind).toBe('unresolved');
    expect(row.candidates).toHaveLength(2);
  });

  it('returns candidates when the name is too far off', async () => {
    net.push(searchClusters);
    const res = await handle(ACTIONS.RESEARCH_RESOLVE, {
      rows: [{ name: 'Zebediah Quillfeather', company: 'Analytical Engines' }],
    });
    expect(res.data.resolved[0].kind).toBe('unresolved');
    expect(res.data.resolved[0].confidence).toBeLessThan(0.85);
  });

  it('resolves a domain or an email domain to a company', async () => {
    net.push(company);
    const byDomain = await handle(ACTIONS.RESEARCH_RESOLVE, {
      rows: [{ domain: 'analytical-engines.com' }],
    });
    expect(byDomain.data.resolved[0]).toMatchObject({
      kind: 'company',
      universalName: 'analytical-engines',
    });

    net.push(company);
    const byEmail = await handle(ACTIONS.RESEARCH_RESOLVE, {
      rows: [{ email: 'ada@analytical-engines.com' }],
    });
    expect(byEmail.data.resolved[0].kind).toBe('company');
  });

  it('reports a row it cannot place at all', async () => {
    const res = await handle(ACTIONS.RESEARCH_RESOLVE, { rows: [{ name: 'Nobody' }] });
    expect(res.data.resolved[0]).toMatchObject({ kind: 'unresolved', confidence: 0 });
  });
});

describe('signals', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('reads the spec §5c signals off the gathered pack', () => {
    const signals = research.packSignals({
      profile: {
        experience: [{ title: 'Chief', company: 'AE', start: Date.now() - 10 * DAY }],
        engagedWithPost: true,
      },
      company: { followerCount: 18400, size: '201-500', description: 'We are hiring analysts.' },
      posts: [{ postedAt: Date.now() - 3 * DAY }],
      mutualConnections: 37,
      connectionStatus: 'connected',
    });

    expect(signals).toEqual(
      expect.arrayContaining([
        'changedJobRecently',
        'postedRecently',
        'engagedWithMe',
        'followers:18400',
        'headcount:201-500',
        'companyHiring',
        'mutuals:37',
        'alreadyConnected',
      ]),
    );
  });

  it('says nothing when there is nothing to say', () => {
    expect(research.packSignals({ profile: {}, posts: [] })).toEqual([]);
  });
});

describe('research.pack end to end', () => {
  function pushOneRow() {
    net.push(profileView); // profile.get
    net.push(company); // company.get for the employer
    net.push(memberPosts); // recent posts
    net.push(mutualConnections); // mutual connections
    net.push(profileView); // network.status
  }

  it('creates a job with an ETA and processes it on the tick', async () => {
    const started = await handle(ACTIONS.RESEARCH_PACK, {
      rows: [{ linkedinUrl: 'https://www.linkedin.com/in/adalovelace/' }],
    });
    expect(started.data.total).toBe(1);
    expect(started.data.jobId).toMatch(/^job_/);
    expect(started.data.etaMs).toBeGreaterThan(0);

    pushOneRow();
    await research.progress();

    const job = (await handle(ACTIONS.RESEARCH_GET, { jobId: started.data.jobId })).data;
    expect(job.status).toBe('done');
    expect(job.done).toBe(1);
    expect(job.packs).toHaveLength(1);

    const pack = job.packs[0];
    expect(pack.profile.fullName).toBe('Ada Lovelace');
    expect(pack.company.name).toBe('Analytical Engines');
    expect(pack.recentPosts[0].likes).toBe(42);
    expect(pack.mutualConnections).toBe(37);
    expect(pack.connectionStatus).toBe('none');
    expect(pack.signals).toContain('changedJobRecently');
    expect(pack.enrichment).toBeUndefined();

    expect(names()).toContain('research_progress');
    expect(names()).toContain('research_completed');
  });

  it('writes a dossier with every section', async () => {
    const started = await handle(ACTIONS.RESEARCH_PACK, {
      rows: [{ linkedinUrl: 'https://www.linkedin.com/in/adalovelace/' }],
    });
    pushOneRow();
    await research.progress();

    const { markdown } = (await handle(ACTIONS.RESEARCH_GET, { jobId: started.data.jobId })).data
      .packs[0];

    for (const heading of [
      '## Summary',
      '## Role & Company',
      '## Career',
      '## Signals',
      '## Recent activity',
      '## Contact',
      '## Public web',
      '## Suggested opener',
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain('# Ada Lovelace');
    expect(markdown).toContain('Chief Analyst');
    expect(markdown).toContain('We are hiring two analysts this quarter.');
    expect(markdown).toMatch(/never crawls the open web/);
  });

  it('writes a csvRow carrying the input columns and the resolution', async () => {
    const started = await handle(ACTIONS.RESEARCH_PACK, {
      rows: [{ linkedinUrl: 'https://www.linkedin.com/in/adalovelace/', ownerNote: 'from event' }],
    });
    pushOneRow();
    await research.progress();

    const { csvRow } = (await handle(ACTIONS.RESEARCH_GET, { jobId: started.data.jobId })).data
      .packs[0];
    expect(csvRow).toMatchObject({
      ownerNote: 'from event',
      resolvedKind: 'person',
      matchConfidence: '1',
      fullName: 'Ada Lovelace',
      company: 'Analytical Engines',
      mutualConnections: '37',
    });
    expect(csvRow.signals).toContain('changedJobRecently');
  });

  it('adds everyone it resolved to a dated Research Pack list', async () => {
    const started = await handle(ACTIONS.RESEARCH_PACK, {
      rows: [{ linkedinUrl: 'https://www.linkedin.com/in/adalovelace/' }],
    });
    pushOneRow();
    await research.progress();

    const { lists } = (await handle(ACTIONS.LIST_GET_ALL, {})).data;
    expect(lists[0].name).toBe('Research Pack 2026-09-09');
    expect(lists[0].count).toBe(1);

    const job = (await handle(ACTIONS.RESEARCH_GET, { jobId: started.data.jobId })).data;
    expect(job.listId).toBe(lists[0].listId);
  });

  it('honours a listName override', async () => {
    await handle(ACTIONS.RESEARCH_PACK, {
      rows: [{ linkedinUrl: 'https://www.linkedin.com/in/adalovelace/' }],
      listName: 'Q4 targets',
    });
    pushOneRow();
    await research.progress();
    expect((await handle(ACTIONS.LIST_GET_ALL, {})).data.lists[0].name).toBe('Q4 targets');
  });

  it('404s an unknown job', async () => {
    const res = await handle(ACTIONS.RESEARCH_GET, { jobId: 'nope' });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('refuses an empty row set', async () => {
    const res = await handle(ACTIONS.RESEARCH_PACK, { rows: [] });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_PARAMS');
  });
});

describe('pacing', () => {
  const rows = (n) =>
    Array.from({ length: n }, (_, i) => ({ linkedinUrl: `https://www.linkedin.com/in/p${i}/` }));

  function pushRows(n) {
    for (let i = 0; i < n; i += 1) {
      net.push(profileView);
      net.push(company);
      net.push(memberPosts);
      net.push(mutualConnections);
      net.push(profileView);
    }
  }

  it('does at most ROWS_PER_TICK rows per tick', async () => {
    const started = await handle(ACTIONS.RESEARCH_PACK, { rows: rows(12) });
    pushRows(12);

    let out = await research.progress();
    expect(out.processed).toBe(research.ROWS_PER_TICK);
    let job = (await handle(ACTIONS.RESEARCH_GET, { jobId: started.data.jobId })).data;
    expect(job.status).toBe('running');
    expect(job.done).toBe(10);

    out = await research.progress();
    expect(out.processed).toBe(2);
    job = (await handle(ACTIONS.RESEARCH_GET, { jobId: started.data.jobId })).data;
    expect(job.status).toBe('done');
  });

  it('pauses when the quota is spent and resumes on the next tick', async () => {
    await setConfig({ accountPreset: 'free', dailyVisitCap: 80 });
    const started = await handle(ACTIONS.RESEARCH_PACK, { rows: rows(4) });
    pushRows(4);

    await quota.record('visit', 80); // visit bucket is spent
    let out = await research.progress();
    expect(out.processed).toBe(1); // the first row goes through, then it stops

    let job = (await handle(ACTIONS.RESEARCH_GET, { jobId: started.data.jobId })).data;
    expect(job.status).toBe('running');

    // A new day: the counters roll over and the job carries on.
    vi.setSystemTime(new Date(2026, 8, 10, 11, 0, 0));
    out = await research.progress();
    expect(out.processed).toBe(3);
    job = (await handle(ACTIONS.RESEARCH_GET, { jobId: started.data.jobId })).data;
    expect(job.status).toBe('done');
  });

  it('narrows the ETA as rows complete', async () => {
    const started = await handle(ACTIONS.RESEARCH_PACK, { rows: rows(12) });
    expect(started.data.etaMs).toBe(12 * 20000);

    pushRows(12);
    await research.progress();
    const job = (await handle(ACTIONS.RESEARCH_GET, { jobId: started.data.jobId })).data;
    expect(job.etaMs).toBeLessThan(started.data.etaMs);
    expect(job.etaMs).toBeGreaterThanOrEqual(0);
  });

  it('does nothing when there is no job', async () => {
    expect(await research.progress()).toEqual({ processed: 0, jobs: 0 });
  });
});

describe('enrichment', () => {
  it('is off unless the job asks and a provider is configured', async () => {
    await handle(ACTIONS.RESEARCH_PACK, {
      rows: [{ linkedinUrl: 'https://www.linkedin.com/in/adalovelace/' }],
      enrich: true,
    });
    net.push(profileView);
    net.push(company);
    net.push(memberPosts);
    net.push(mutualConnections);
    net.push(profileView);

    await research.progress();
    const packs = await storage.get(storage.K.researchPacks((await research.allJobs())[0].jobId));
    expect(packs[0].enrichment).toEqual({ provider: 'none' });
  });

  it('builds the Hunter request from the company domain and the name', () => {
    const req = enrich.hunterRequest({
      domain: 'analytical-engines.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      apiKey: 'hunter-key',
    });
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe(enrich.HUNTER_BASE);
    expect(url.searchParams.get('domain')).toBe('analytical-engines.com');
    expect(url.searchParams.get('first_name')).toBe('Ada');
    expect(url.searchParams.get('last_name')).toBe('Lovelace');
    expect(url.searchParams.get('api_key')).toBe('hunter-key');
  });

  it('needs a domain, a key and a name', () => {
    expect(enrich.hunterRequest({ firstName: 'Ada', apiKey: 'k' })).toBe(null);
    expect(enrich.hunterRequest({ domain: 'x.com', firstName: 'Ada' })).toBe(null);
    expect(enrich.hunterRequest({ domain: 'x.com', apiKey: 'k' })).toBe(null);
  });

  it('splits a full name when the parts are not given', () => {
    const req = enrich.hunterRequest({
      domain: 'x.com',
      fullName: 'Ada Byron Lovelace',
      apiKey: 'k',
    });
    const url = new URL(req.url);
    expect(url.searchParams.get('first_name')).toBe('Ada');
    expect(url.searchParams.get('last_name')).toBe('Byron Lovelace');
  });

  it('reads Hunter’s answer into the contract shape', async () => {
    await setConfig({ enrichment: { provider: 'hunter', apiKey: 'hunter-key' } });
    net.push({ data: { email: 'ada@analytical-engines.com', phone_number: '+44 20', score: 94 } });

    const out = await enrich.lookupEmail(
      { firstName: 'Ada', lastName: 'Lovelace' },
      { website: 'https://analytical-engines.example' },
    );
    expect(out).toMatchObject({
      provider: 'hunter',
      email: 'ada@analytical-engines.com',
      phone: '+44 20',
    });
    expect(net.calls[0].url).toContain('analytical-engines.example');
  });

  it('never fails a pack when the provider errors', async () => {
    await setConfig({ enrichment: { provider: 'hunter', apiKey: 'k' } });
    net.push({ __status: 429, body: {} });
    const out = await enrich.lookupEmail(
      { firstName: 'Ada', lastName: 'Lovelace' },
      { website: 'https://x.com' },
    );
    expect(out.provider).toBe('hunter');
    expect(out.email).toBeUndefined();
  });

  it('derives the domain from the company website', () => {
    expect(enrich.domainFor({}, { website: 'https://www.analytical-engines.example/careers' })).toBe(
      'analytical-engines.example',
    );
    expect(enrich.domainFor({}, {})).toBe('');
  });
});
