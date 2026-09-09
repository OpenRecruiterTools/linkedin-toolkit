import { describe, it, expect, beforeEach } from 'vitest';
import { ACTIONS, ERROR } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as ai from '../../src/background/ai.js';
import { promptFor, parseOutput } from '../../src/background/ai-prompts.js';
import { stubFetch, status } from '../helpers/net.js';
import '../../src/background/ai.js';

const KEY = 'sk-secret-key-value';

const ada = {
  publicId: 'adalovelace',
  fullName: 'Ada Lovelace',
  title: 'Chief Analyst',
  company: 'Analytical Engines',
  headline: 'Chief Analyst at Analytical Engines',
  location: 'London',
};

let net;

beforeEach(() => {
  net = stubFetch();
});

describe('configuration', () => {
  it('AI_NOT_CONFIGURED when no provider is set', async () => {
    const res = await handle(ACTIONS.AI_COMPLETE, { task: 'opener', input: { profile: ada } });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.AI_NOT_CONFIGURED);
    expect(net.calls).toHaveLength(0);
  });

  it('AI_NOT_CONFIGURED when a hosted provider has no key', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: '' } });
    await expect(ai.complete('opener', { profile: ada })).rejects.toMatchObject({
      code: ERROR.AI_NOT_CONFIGURED,
    });
  });

  it('AI_NOT_CONFIGURED when openai-compatible has no baseUrl', async () => {
    await setConfig({ ai: { provider: 'openai-compatible', apiKey: KEY, baseUrl: '' } });
    await expect(ai.complete('opener', { profile: ada })).rejects.toMatchObject({
      code: ERROR.AI_NOT_CONFIGURED,
    });
  });

  it('ollama needs no key', async () => {
    await setConfig({ ai: { provider: 'ollama' } });
    net.push({ message: { content: 'Hello Ada.' } });
    const out = await ai.complete('opener', { profile: ada });
    expect(out.output).toBe('Hello Ada.');
  });
});

describe('adapters', () => {
  it('anthropic', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: KEY } });
    net.push({ content: [{ type: 'text', text: 'Hi Ada — nice work on the engines.' }] });

    const out = await ai.complete('opener', { profile: ada, tone: 'warm' });
    const call = net.calls[0];

    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.method).toBe('POST');
    expect(call.headers['x-api-key']).toBe(KEY);
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(call.headers.authorization).toBeUndefined();
    expect(call.json.model).toBe('claude-sonnet-5');
    expect(call.json.system).toContain('opener');
    expect(call.json.messages[0].role).toBe('user');
    expect(call.json.messages[0].content).toContain('Analytical Engines');
    expect(out).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(out.output).toBe('Hi Ada — nice work on the engines.');
  });

  it('openai', async () => {
    await setConfig({ ai: { provider: 'openai', apiKey: KEY } });
    net.push({ choices: [{ message: { content: 'Hi Ada.' } }] });

    const out = await ai.complete('summary', { profile: ada });
    const call = net.calls[0];

    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.json.model).toBe('gpt-5-mini');
    expect(call.json.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(out.output).toBe('Hi Ada.');
  });

  it('gemini', async () => {
    await setConfig({ ai: { provider: 'gemini', apiKey: KEY } });
    net.push({ candidates: [{ content: { parts: [{ text: 'Hi Ada.' }] } }] });

    const out = await ai.complete('comment', { profile: ada, post: 'We are hiring.' });
    const call = net.calls[0];

    expect(call.url).toContain('gemini-2.5-flash:generateContent');
    expect(call.url).toContain(`key=${KEY}`);
    expect(call.json.contents[0].parts[0].text).toContain('We are hiring.');
    expect(call.json.systemInstruction.parts[0].text).toBeTruthy();
    expect(out.model).toBe('gemini-2.5-flash');
  });

  it('ollama', async () => {
    await setConfig({ ai: { provider: 'ollama' } });
    net.push({ message: { content: 'Hi Ada.' } });

    await ai.complete('opener', { profile: ada });
    const call = net.calls[0];

    expect(call.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(call.json.model).toBe('llama3.1:8b');
    expect(call.json.stream).toBe(false);
  });

  it('openai-compatible honours the baseUrl and trims a trailing slash', async () => {
    await setConfig({
      ai: { provider: 'openai-compatible', apiKey: KEY, baseUrl: 'http://127.0.0.1:1234/v1/', model: 'local-model' },
    });
    net.push({ choices: [{ message: { content: 'ok' } }] });

    await ai.complete('opener', { profile: ada });
    expect(net.calls[0].url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(net.calls[0].json.model).toBe('local-model');
  });

  it('an overridden model wins over the default', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: KEY, model: 'claude-opus-5' } });
    net.push({ content: [{ text: 'x' }] });
    const out = await ai.complete('opener', { profile: ada });
    expect(out.model).toBe('claude-opus-5');
  });
});

describe('errors', () => {
  it('AI_ERROR on a non-200, and the key never appears in the message', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: KEY } });
    net.push(status(401, { error: { message: `bad key ${KEY}` } }));
    const e = await ai.complete('opener', { profile: ada }).catch((x) => x);
    expect(e.code).toBe(ERROR.AI_ERROR);
    expect(e.message).not.toContain(KEY);
  });

  it('AI_ERROR when the provider returns nothing usable', async () => {
    await setConfig({ ai: { provider: 'openai', apiKey: KEY } });
    net.push({ choices: [] });
    await expect(ai.complete('opener', { profile: ada })).rejects.toMatchObject({
      code: ERROR.AI_ERROR,
    });
  });
});

describe('prompts', () => {
  it('opener passes only profile facts and aims under LinkedIn\'s 200-character limit', () => {
    const { system, user } = promptFor('opener', { profile: ada, tone: 'direct' });
    // 180, not 200: a rendered name and job title must not push it over.
    expect(system).toMatch(/180/);
    expect(system).toMatch(/200/);
    expect(system).not.toMatch(/300 characters/);
    expect(system).toMatch(/do not invent|never invent/i);
    expect(system).toContain('direct');
    expect(user).toContain('Ada Lovelace');
    expect(user).toContain('Analytical Engines');
  });

  it('has a prompt for every contract task', () => {
    for (const task of ['opener', 'summary', 'sentiment', 'comment', 'score']) {
      const p = promptFor(task, { profile: ada, message: 'hi', brief: 'b', post: 'p' });
      expect(p.system).toBeTruthy();
      expect(p.user).toBeTruthy();
    }
  });

  it('sentiment parses to a sentiment and an intent', () => {
    expect(parseOutput('sentiment', '{"sentiment":"positive","intent":"book_call"}')).toEqual({
      sentiment: 'positive',
      intent: 'book_call',
    });
    expect(parseOutput('sentiment', 'Positive — they want a call')).toMatchObject({
      sentiment: 'positive',
    });
  });

  it('score parses to a number and a reason', () => {
    expect(parseOutput('score', '{"score":82,"reason":"Exact title match"}')).toEqual({
      score: 82,
      reason: 'Exact title match',
    });
    expect(parseOutput('score', '73 — close enough').score).toBe(73);
    expect(parseOutput('score', 'nonsense').score).toBe(0);
  });

  it('text tasks come back as trimmed strings', () => {
    expect(parseOutput('opener', '  Hi Ada.  ')).toBe('Hi Ada.');
  });
});

describe('ai.complete action', () => {
  it('returns output, provider and model through the engine', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: KEY } });
    net.push({ content: [{ text: 'Hi Ada.' }] });
    const res = await handle(ACTIONS.AI_COMPLETE, { task: 'opener', input: { profile: ada } });
    expect(res.data).toEqual({ output: 'Hi Ada.', provider: 'anthropic', model: 'claude-sonnet-5' });
  });
});
