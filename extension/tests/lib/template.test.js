import { describe, it, expect } from 'vitest';
import { renderTemplate, pickVariant } from '../../src/lib/template.js';

const ada = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  fullName: 'Ada Lovelace',
  company: 'Analytical Engines',
  headline: 'Mathematician',
};

describe('renderTemplate', () => {
  it('substitutes known fields', () => {
    expect(renderTemplate('Hi {{firstName}} at {{company}}', ada)).toBe(
      'Hi Ada at Analytical Engines',
    );
  });

  it('falls back to title from headline and trims whitespace runs', () => {
    expect(renderTemplate('{{title}}', ada)).toBe('Mathematician');
  });

  it('uses an inline fallback after a pipe', () => {
    expect(renderTemplate('Hi {{firstName|there}}', {})).toBe('Hi there');
    expect(renderTemplate('Hi {{firstName|there}}', ada)).toBe('Hi Ada');
  });

  it('leaves an unknown placeholder empty and tidies the result', () => {
    expect(renderTemplate('Hi {{nickname}}!', ada)).toBe('Hi !');
  });

  it('returns an empty string for a missing template', () => {
    expect(renderTemplate(undefined, ada)).toBe('');
  });

  it('tolerates spaces inside the braces', () => {
    expect(renderTemplate('{{ firstName }}', ada)).toBe('Ada');
  });
});

describe('pickVariant', () => {
  it('rotates round-robin over the variants', () => {
    const v = ['a', 'b', 'c'];
    expect(pickVariant(v, 0)).toBe('a');
    expect(pickVariant(v, 1)).toBe('b');
    expect(pickVariant(v, 3)).toBe('a');
  });

  it('returns undefined for no variants', () => {
    expect(pickVariant([], 2)).toBeUndefined();
    expect(pickVariant(undefined, 0)).toBeUndefined();
  });
});
