/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

import { el, render, clear, fmtDate, fmtNumber, fmtDuration, fmtAgo } from '../../src/ui/dom.js';

describe('el', () => {
  it('creates an element with attributes and children', () => {
    const node = el('div', { class: 'card', title: 'hi' }, el('span', 'one'), 'two');
    expect(node.tagName).toBe('DIV');
    expect(node.getAttribute('class')).toBe('card');
    expect(node.title).toBe('hi');
    expect(node.textContent).toBe('onetwo');
  });

  it('treats a non-object second argument as the first child', () => {
    expect(el('p', 'hello').textContent).toBe('hello');
    expect(el('p', el('b', 'x')).firstChild.tagName).toBe('B');
  });

  it('skips null, undefined and false children and flattens arrays', () => {
    const node = el('ul', null, [el('li', 'a'), null, false, [el('li', 'b')]], undefined);
    expect(node.children).toHaveLength(2);
  });

  it('binds on* handlers as listeners', () => {
    const onclick = vi.fn();
    const node = el('button', { onclick }, 'Go');
    node.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('sets properties for form controls and attributes for the rest', () => {
    const box = el('input', { type: 'checkbox', checked: true, 'data-testid': 'x' });
    expect(box.checked).toBe(true);
    expect(box.getAttribute('data-testid')).toBe('x');

    const label = el('label', { for: 'field-1' });
    expect(label.getAttribute('for')).toBe('field-1');
  });

  it('never parses markup as HTML', () => {
    const node = el('div', '<img src=x onerror=boom>');
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toContain('<img');
  });

  it('applies style and dataset objects', () => {
    const node = el('div', { style: { width: '50%' }, dataset: { kind: 'bar' } });
    expect(node.style.width).toBe('50%');
    expect(node.dataset.kind).toBe('bar');
  });
});

describe('render', () => {
  it('replaces the contents of a container', () => {
    const host = el('div', null, el('p', 'old'));
    render(host, [el('p', 'new'), 'tail']);
    expect(host.textContent).toBe('newtail');
    expect(host.querySelectorAll('p')).toHaveLength(1);
  });

  it('clear() empties a node', () => {
    const host = el('div', null, el('p', 'x'));
    clear(host);
    expect(host.textContent).toBe('');
  });
});

describe('formatters', () => {
  it('fmtNumber groups thousands and guards non-numbers', () => {
    expect(fmtNumber(1234)).toBe((1234).toLocaleString());
    expect(fmtNumber(undefined)).toBe('—');
    expect(fmtNumber('nope')).toBe('—');
  });

  it('fmtDate renders a timestamp and guards empties', () => {
    expect(fmtDate(0)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate(1_757_000_000_000)).toMatch(/20\d\d/);
    expect(fmtDate(1_757_000_000_000, { time: true })).toMatch(/:/);
  });

  it('fmtDuration reads in human units', () => {
    expect(fmtDuration(0)).toBe('now');
    expect(fmtDuration(45_000)).toBe('45s');
    expect(fmtDuration(90_000)).toBe('2m');
    expect(fmtDuration(3 * 3_600_000 + 600_000)).toBe('3h 10m');
    expect(fmtDuration(50 * 3_600_000)).toBe('2d 2h');
  });

  it('fmtAgo describes recent timestamps', () => {
    expect(fmtAgo(Date.now() - 5_000)).toBe('just now');
    expect(fmtAgo(Date.now() - 15 * 60_000)).toBe('15m ago');
    expect(fmtAgo(undefined)).toBe('—');
  });
});
