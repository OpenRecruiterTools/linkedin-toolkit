import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS, ERROR } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as permissions from '../../src/lib/permissions.js';
import * as ai from '../../src/background/ai.js';
import * as enrich from '../../src/background/enrich.js';
import '../../src/background/ai.js';
import { stubFetch } from '../helpers/net.js';

let net;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 9, 11, 0, 0));
  net = stubFetch();
});

afterEach(() => vi.useRealTimers());

/** Nothing is granted until a test asks for it. */
function denyAll() {
  chrome.__mock.grantAllPermissions = false;
}

describe('originPatternFor', () => {
  it('reduces a URL to the pattern Chrome wants', () => {
    expect(permissions.originPatternFor('https://api.anthropic.com/v1/messages')).toBe(
      'https://api.anthropic.com/*',
    );
    expect(permissions.originPatternFor('http://127.0.0.1:11434/api/chat')).toBe(
      'http://127.0.0.1:11434/*',
    );
    expect(permissions.originPatternFor('not a url')).toBe('');
  });
});

describe('aiEndpointFor', () => {
  it('knows where each provider lives', () => {
    expect(permissions.aiEndpointFor({ provider: 'anthropic' })).toBe('https://api.anthropic.com');
    expect(permissions.aiEndpointFor({ provider: 'openai' })).toBe('https://api.openai.com');
    expect(permissions.aiEndpointFor({ provider: 'gemini' })).toContain('googleapis.com');
    expect(permissions.aiEndpointFor({ provider: 'ollama' })).toBe('http://127.0.0.1:11434');
    expect(permissions.aiEndpointFor({ provider: 'none' })).toBe('');
  });

  it('uses the custom base URL for an openai-compatible provider', () => {
    expect(
      permissions.aiEndpointFor({ provider: 'openai-compatible', baseUrl: 'http://box:1234/v1' }),
    ).toBe('http://box:1234/v1');
    expect(permissions.aiEndpointFor({ provider: 'openai-compatible' })).toBe('');
  });

  it('enrichmentEndpointFor covers Hunter and nothing else', () => {
    expect(permissions.enrichmentEndpointFor({ provider: 'hunter' })).toBe('https://api.hunter.io');
    expect(permissions.enrichmentEndpointFor({ provider: 'none' })).toBe('');
  });
});

describe('hasHostAccess / requestHostAccess', () => {
  it('reports what has been granted and grants on request', async () => {
    denyAll();
    expect(await permissions.hasHostAccess('https://api.openai.com/v1/x')).toBe(false);

    expect(await permissions.requestHostAccess('https://api.openai.com/v1/x')).toBe(true);
    expect(await permissions.hasHostAccess('https://api.openai.com/v1/x')).toBe(true);

    // A grant is per origin, not global.
    expect(await permissions.hasHostAccess('https://api.anthropic.com/v1/x')).toBe(false);
  });

  it('drops access again', async () => {
    denyAll();
    await permissions.requestHostAccess('https://api.hunter.io/v2/x');
    expect(await permissions.hasHostAccess('https://api.hunter.io/v2/x')).toBe(true);
    await permissions.dropHostAccess('https://api.hunter.io/v2/x');
    expect(await permissions.hasHostAccess('https://api.hunter.io/v2/x')).toBe(false);
  });

  it('refuses a URL it cannot parse', async () => {
    expect(await permissions.hasHostAccess('nonsense')).toBe(false);
    expect(await permissions.requestHostAccess('')).toBe(false);
  });
});

describe('ai.complete without the host permission', () => {
  beforeEach(async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: 'sk-test' } });
  });

  it('is AI_NOT_CONFIGURED, with a howToFix, and never fetches', async () => {
    denyAll();
    const res = await handle(ACTIONS.AI_COMPLETE, {
      task: 'opener',
      input: { profile: { fullName: 'Ada' } },
    });

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.AI_NOT_CONFIGURED);
    expect(res.error.message).toContain('https://api.anthropic.com/*');
    expect(res.error.howToFix).toMatch(/grant access/i);
    expect(net.calls).toHaveLength(0);
  });

  it('works again once the origin is granted', async () => {
    denyAll();
    await permissions.requestHostAccess('https://api.anthropic.com');
    net.push({ content: [{ text: 'Hi Ada.' }] });

    const out = await ai.complete('opener', { profile: { fullName: 'Ada' } });
    expect(out.output).toBe('Hi Ada.');
  });

  it('isConfigured is false while the permission is missing', async () => {
    denyAll();
    expect(await ai.isConfigured()).toBe(false);
    await permissions.requestHostAccess('https://api.anthropic.com');
    expect(await ai.isConfigured()).toBe(true);
  });

  it('checks the custom origin for an openai-compatible provider', async () => {
    denyAll();
    await setConfig({
      ai: { provider: 'openai-compatible', apiKey: 'k', baseUrl: 'http://box:1234/v1' },
    });
    expect(await ai.isConfigured()).toBe(false);

    await permissions.requestHostAccess('http://box:1234/v1');
    expect(await ai.isConfigured()).toBe(true);
  });
});

describe('enrichment without the host permission', () => {
  it('says so and never fails a pack', async () => {
    denyAll();
    await setConfig({ enrichment: { provider: 'hunter', apiKey: 'hk' } });

    const out = await enrich.lookupEmail(
      { firstName: 'Ada', lastName: 'Lovelace' },
      { website: 'https://analytical-engines.example' },
    );

    expect(out).toEqual({ provider: 'hunter', reason: 'permission-missing' });
    expect(net.calls).toHaveLength(0);
    expect(await enrich.isEnrichmentConfigured()).toBe(false);
  });

  it('goes through once granted', async () => {
    denyAll();
    await setConfig({ enrichment: { provider: 'hunter', apiKey: 'hk' } });
    await permissions.requestHostAccess(enrich.HUNTER_BASE);
    net.push({ data: { email: 'ada@analytical-engines.example' } });

    const out = await enrich.lookupEmail(
      { firstName: 'Ada', lastName: 'Lovelace' },
      { website: 'https://analytical-engines.example' },
    );
    expect(out.email).toBe('ada@analytical-engines.example');
  });
});
