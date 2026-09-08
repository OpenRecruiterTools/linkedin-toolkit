/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import * as research from '../../src/popup/tabs/research.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint, profileFixture } from './helpers.js';

const CSV =
  'name,linkedin_url,email,domain,company,Owner\n' +
  'Ada Lovelace,,ada@example.com,example.com,Analytical Engine Co,Dom\n' +
  'Grace Hopper,,grace@example.com,navy.example,Navy,Dom';

const packFixture = (overrides = {}) => ({
  row: { name: 'Ada Lovelace', company: 'Analytical Engine Co' },
  resolved: { kind: 'person', publicId: 'ada', confidence: 0.92 },
  profile: profileFixture(),
  signals: ['posted last week'],
  markdown: '# Ada Lovelace\n\nAnalytical engines.',
  csvRow: { name: 'Ada Lovelace', publicId: 'ada', email: 'ada@example.com' },
  ...overrides,
});

const unresolvedPack = () =>
  packFixture({
    row: { name: 'Grace Hopper', company: 'Navy' },
    resolved: {
      kind: 'unresolved',
      confidence: 0.2,
      candidates: [
        profileFixture('grace1', { fullName: 'Grace Hopper', headline: 'Rear Admiral' }),
        profileFixture('grace2', { fullName: 'Grace M Hopper', headline: 'Compilers' }),
      ],
    },
    profile: undefined,
    markdown: '',
    csvRow: null,
  });

function paste(host, text) {
  const area = host.querySelector('textarea');
  area.value = text;
  [...host.querySelectorAll('button')]
    .find((b) => b.textContent.includes('Read pasted CSV'))
    .click();
}

const clickIn = (host, text) => {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (!node) throw new Error(`no button "${text}"`);
  node.click();
  return node;
};

afterEach(() => {
  research.unmount();
  vi.useRealTimers();
});

describe('Research tab', () => {
  it('parses a pasted CSV and previews the column mapping', async () => {
    stubEngine({});
    const host = mountPoint();
    await research.mount(host);

    paste(host, CSV);

    expect(host.textContent).toContain('2 rows read');
    const mapping = host.querySelector('.mapping');
    expect(mapping.querySelector('[data-field="name"]').value).toBe('name');
    expect(mapping.querySelector('[data-field="linkedinUrl"]').value).toBe('linkedin_url');
    expect(mapping.querySelector('[data-field="company"]').value).toBe('company');
    // the unmapped column rides along in the preview
    expect([...mapping.querySelectorAll('th')].map((n) => n.textContent)).toContain('Owner');
  });

  it('lets a column be remapped by hand', async () => {
    const engine = stubEngine({ [ACTIONS.RESEARCH_PACK]: { jobId: 'j1', total: 2, etaMs: 1000 } });
    const host = mountPoint();
    await research.mount(host);
    paste(host, CSV);

    const nameSelect = host.querySelector('[data-field="name"]');
    nameSelect.value = 'company';
    nameSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

    clickIn(host, 'Build research packs');
    await flush(8);

    expect(engine.paramsFor(ACTIONS.RESEARCH_PACK).rows[0].name).toBe('Analytical Engine Co');
  });

  it('starts a job with the chosen options and polls immediately', async () => {
    const engine = stubEngine({
      [ACTIONS.RESEARCH_PACK]: { jobId: 'j1', total: 2, etaMs: 60_000 },
      [ACTIONS.RESEARCH_GET]: {
        jobId: 'j1',
        status: 'running',
        done: 1,
        total: 2,
        packs: [packFixture()],
      },
    });
    const host = mountPoint();
    await research.mount(host);
    paste(host, CSV);

    const [full, enrich] = host.querySelectorAll('.research-run input[type="checkbox"]');
    full.checked = true;
    enrich.checked = true;
    host.querySelector('.research-run input.input').value = 'Research 2026';

    clickIn(host, 'Build research packs');
    await flush(10);

    const params = engine.paramsFor(ACTIONS.RESEARCH_PACK);
    expect(params.rows).toHaveLength(2);
    expect(params.listName).toBe('Research 2026');
    expect(params.enrich).toBe(true);
    expect(params.full).toBe(true);
    expect(engine.paramsFor(ACTIONS.RESEARCH_GET)).toEqual({ jobId: 'j1' });
    expect(host.textContent).toContain('1 of 2');
    expect(host.textContent).toContain('left');
  });

  it('polls research.get every five seconds until the job stops', async () => {
    vi.useFakeTimers();
    const engine = stubEngine({
      [ACTIONS.RESEARCH_PACK]: { jobId: 'j1', total: 2, etaMs: 10_000 },
      [ACTIONS.RESEARCH_GET]: () => ({
        jobId: 'j1',
        status: engine.countOf(ACTIONS.RESEARCH_GET) >= 3 ? 'complete' : 'running',
        done: 2,
        total: 2,
        packs: [packFixture()],
      }),
    });
    const host = mountPoint();
    await research.mount(host);
    paste(host, CSV);

    clickIn(host, 'Build research packs');
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.countOf(ACTIONS.RESEARCH_GET)).toBe(1);

    await vi.advanceTimersByTimeAsync(research.POLL_MS);
    expect(engine.countOf(ACTIONS.RESEARCH_GET)).toBe(2);

    await vi.advanceTimersByTimeAsync(research.POLL_MS * 4);
    // stops once the engine reports a status other than running
    expect(engine.countOf(ACTIONS.RESEARCH_GET)).toBe(3);
  });

  it('shows resolved and unresolved rows, with a candidate picker', async () => {
    stubEngine({
      [ACTIONS.RESEARCH_PACK]: { jobId: 'j1', total: 2, etaMs: 1000 },
      [ACTIONS.RESEARCH_GET]: {
        jobId: 'j1',
        status: 'complete',
        done: 2,
        total: 2,
        packs: [packFixture(), unresolvedPack()],
      },
    });
    const host = mountPoint();
    await research.mount(host);
    paste(host, CSV);
    clickIn(host, 'Build research packs');
    await flush(10);

    const results = host.querySelector('.research-results');
    expect(results.textContent).toContain('1 unresolved');
    expect(results.querySelectorAll('[data-pack]')).toHaveLength(2);
    expect(results.querySelector('[data-pack="0"]').textContent).toContain('person');
    expect(results.querySelector('[data-pack="0"]').textContent).toContain('92% sure');

    const picker = results.querySelector('[data-picker="1"]');
    expect(picker).toBeTruthy();
    expect([...picker.options]).toHaveLength(3);
    expect(results.querySelector('[data-pack="0"] select')).toBeNull();
  });

  it('re-runs one row against the candidate the human picked', async () => {
    const engine = stubEngine({
      [ACTIONS.RESEARCH_PACK]: { jobId: 'j2', total: 1, etaMs: 500 },
      [ACTIONS.RESEARCH_GET]: {
        jobId: 'j1',
        status: 'complete',
        done: 1,
        total: 1,
        packs: [unresolvedPack()],
      },
    });
    const host = mountPoint();
    await research.mount(host);
    paste(host, CSV);
    clickIn(host, 'Build research packs');
    await flush(10);

    const picker = host.querySelector('[data-picker="0"]');
    picker.value = 'https://www.linkedin.com/in/grace2/';
    clickIn(host.querySelector('[data-pack="0"]'), 'Use this');
    await flush(10);

    const calls = engine.allParamsFor(ACTIONS.RESEARCH_PACK);
    expect(calls).toHaveLength(2);
    expect(calls[1].rows).toEqual([
      {
        name: 'Grace Hopper',
        company: 'Navy',
        linkedinUrl: 'https://www.linkedin.com/in/grace2/',
      },
    ]);
  });

  it('downloads output.csv and packs.md', async () => {
    stubEngine({
      [ACTIONS.RESEARCH_PACK]: { jobId: 'j1', total: 1, etaMs: 500 },
      [ACTIONS.RESEARCH_GET]: {
        jobId: 'j1',
        status: 'complete',
        done: 1,
        total: 1,
        packs: [packFixture()],
      },
    });
    const host = mountPoint();
    await research.mount(host);
    paste(host, CSV);
    clickIn(host, 'Build research packs');
    await flush(10);

    clickIn(host, 'Download output.csv');
    await flush(6);
    clickIn(host, 'Download packs.md');
    await flush(6);

    const downloads = chrome.__mock.downloads;
    expect(downloads).toHaveLength(2);
    expect(downloads[0].filename).toMatch(/^research-j1-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(decodeURIComponent(downloads[0].url)).toContain('Ada Lovelace');
    expect(downloads[1].filename).toMatch(/\.md$/);
    expect(decodeURIComponent(downloads[1].url)).toContain('# Ada Lovelace');
  });

  it('rejects text that is not a CSV', async () => {
    stubEngine({});
    const host = mountPoint();
    await research.mount(host);

    paste(host, '');

    expect(host.querySelector('.err').hidden).toBe(false);
    expect(host.querySelector('.err').textContent).toContain('does not look like a CSV');
  });
});
