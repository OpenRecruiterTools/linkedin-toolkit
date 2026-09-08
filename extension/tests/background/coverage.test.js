import { describe, it, expect } from 'vitest';
import { ACTIONS } from '../../src/lib/actions.js';
import { registeredActions } from '../../src/background/engine.js';
import '../../src/background/index.js';

describe('action coverage', () => {
  it('the service worker registers a handler for every contract action', () => {
    const missing = Object.values(ACTIONS).filter((a) => !registeredActions().includes(a));
    expect(missing).toEqual([]);
  });

  it('registers nothing that is not in the contract', () => {
    const known = new Set(Object.values(ACTIONS));
    expect(registeredActions().filter((a) => !known.has(a))).toEqual([]);
  });
});
