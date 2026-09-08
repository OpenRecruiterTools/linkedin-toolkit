import { describe, it, expect } from 'vitest';
import { toCsv, fromCsv, escapeCsvValue } from '../../src/lib/csv.js';

describe('escapeCsvValue', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(escapeCsvValue('plain')).toBe('plain');
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvValue('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(['a', 'b'])).toBe('a; b');
  });
});

describe('toCsv', () => {
  it('writes a header row and maps columns', () => {
    const csv = toCsv([{ a: 1, b: 'x,y' }], [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]);
    expect(csv).toBe('A,B\n1,"x,y"');
  });

  it('accepts plain key names as columns and derives labels', () => {
    const csv = toCsv([{ fullName: 'Ada' }], ['fullName']);
    expect(csv).toBe('fullName\nAda');
  });

  it('infers columns from the first row when none are given', () => {
    expect(toCsv([{ a: 1, b: 2 }])).toBe('a,b\n1,2');
  });

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('fromCsv', () => {
  it('parses a header and rows', () => {
    const { headers, rows } = fromCsv('name,company\nAda,AE\nBob,Beta');
    expect(headers).toEqual(['name', 'company']);
    expect(rows).toEqual([
      { name: 'Ada', company: 'AE' },
      { name: 'Bob', company: 'Beta' },
    ]);
  });

  it('handles quoted fields with commas, quotes and newlines', () => {
    const { rows } = fromCsv('a,b\n"x,y","say ""hi"""\n"multi\nline",z');
    expect(rows[0]).toEqual({ a: 'x,y', b: 'say "hi"' });
    expect(rows[1]).toEqual({ a: 'multi\nline', b: 'z' });
  });

  it('tolerates CRLF and a trailing newline', () => {
    const { rows } = fromCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('returns nothing for empty input', () => {
    expect(fromCsv('')).toEqual({ headers: [], rows: [] });
  });
});
