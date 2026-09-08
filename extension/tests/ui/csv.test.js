/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import {
  parseCsv,
  toCsv,
  guessMapping,
  toResearchRows,
  RESEARCH_FIELDS,
} from '../../src/ui/csv.js';

const BOM = String.fromCharCode(0xfeff);

describe('parseCsv', () => {
  it('reads a header row and objects keyed by it', () => {
    const { headers, rows } = parseCsv('name,email\nAda,ada@example.com\nGrace,grace@example.com');
    expect(headers).toEqual(['name', 'email']);
    expect(rows).toEqual([
      { name: 'Ada', email: 'ada@example.com' },
      { name: 'Grace', email: 'grace@example.com' },
    ]);
  });

  it('handles quotes, commas, doubled quotes and CRLF', () => {
    const { rows } = parseCsv('name,title\r\n"Lovelace, Ada","Analyst, ""first"""\r\n');
    expect(rows).toEqual([{ name: 'Lovelace, Ada', title: 'Analyst, "first"' }]);
  });

  it('keeps newlines inside quoted fields', () => {
    const { rows } = parseCsv('name,note\nAda,"line one\nline two"');
    expect(rows[0].note).toBe('line one\nline two');
  });

  it('strips a byte-order mark and skips blank lines', () => {
    const { headers, rows } = parseCsv(`${BOM}name,email\n\nAda,ada@example.com\n\n`);
    expect(headers).toEqual(['name', 'email']);
    expect(rows).toHaveLength(1);
  });

  it('pads short rows and survives empty input', () => {
    expect(parseCsv('a,b\n1').rows).toEqual([{ a: '1', b: '' }]);
    expect(parseCsv('')).toEqual({ headers: [], rows: [], matrix: [] });
  });
});

describe('toCsv', () => {
  it('puts profile columns first and quotes what needs it', () => {
    const csv = toCsv([
      {
        fullName: 'Ada Lovelace',
        headline: 'Engineer, Analyst',
        publicId: 'ada',
        note: 'says "hi"',
      },
    ]);
    const [header, line] = csv.split('\n');
    expect(header.startsWith('fullName,headline,publicId')).toBe(true);
    expect(line).toContain('"Engineer, Analyst"');
    expect(line).toContain('"says ""hi"""');
  });

  it('joins arrays and drops the heavy capture fields', () => {
    const csv = toCsv([
      { fullName: 'Ada', skills: ['maths', 'engines'], pageText: 'x'.repeat(50) },
    ]);
    expect(csv).toContain('maths; engines');
    expect(csv).not.toContain('pageText');
  });

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('guessMapping', () => {
  it('maps the documented headers', () => {
    const mapping = guessMapping(['name', 'linkedin_url', 'email', 'domain', 'company']);
    expect(mapping).toEqual({
      name: 'name',
      linkedinUrl: 'linkedin_url',
      email: 'email',
      domain: 'domain',
      company: 'company',
    });
  });

  it('tolerates extra columns and different spellings', () => {
    const mapping = guessMapping([
      'Full Name',
      'LinkedIn URL',
      'Work Email',
      'Website',
      'Company Name',
      'Owner',
      'Deal size',
    ]);
    expect(mapping.name).toBe('Full Name');
    expect(mapping.linkedinUrl).toBe('LinkedIn URL');
    expect(mapping.email).toBe('Work Email');
    expect(mapping.domain).toBe('Website');
    expect(mapping.company).toBe('Company Name');
  });

  it('leaves a field unmapped when nothing matches', () => {
    const mapping = guessMapping(['first', 'second']);
    for (const { key } of RESEARCH_FIELDS) expect(mapping[key]).toBeNull();
  });

  it('never maps one column onto two fields', () => {
    const mapping = guessMapping(['url']);
    const used = Object.values(mapping).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('toResearchRows', () => {
  it('produces ResearchRow objects and carries extra columns through', () => {
    const { rows } = parseCsv(
      'name,linkedin_url,email,domain,company,Owner\n' +
        'Ada,https://www.linkedin.com/in/ada,ada@example.com,example.com,Analytical Engine Co,Dom',
    );
    const mapping = guessMapping(Object.keys(rows[0]));

    expect(toResearchRows(rows, mapping)).toEqual([
      {
        name: 'Ada',
        linkedinUrl: 'https://www.linkedin.com/in/ada',
        email: 'ada@example.com',
        domain: 'example.com',
        company: 'Analytical Engine Co',
        Owner: 'Dom',
      },
    ]);
  });

  it('omits empty cells rather than sending blank strings', () => {
    const rows = [{ name: 'Ada', email: '   ', Owner: '' }];
    expect(toResearchRows(rows, guessMapping(['name', 'email', 'Owner']))).toEqual([
      { name: 'Ada' },
    ]);
  });
});
