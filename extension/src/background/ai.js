/**
 * LinkedIn Toolkit — AI provider adapters.
 *
 * Bring your own key (or run Ollama locally). Each adapter turns one prompt
 * into a request and one response into text; nothing about the user's key ever
 * reaches a log, an error message or the event log.
 */

import { ACTIONS, ERROR, EngineError } from '../lib/actions.js';
import { getConfig } from '../lib/config.js';
import { register } from './engine.js';
import { parseOutput, promptFor } from './ai-prompts.js';

export const DEFAULT_MODELS = Object.freeze({
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5-mini',
  gemini: 'gemini-2.5-flash',
  ollama: 'llama3.1:8b',
  'openai-compatible': 'gpt-4o-mini',
});

export const DEFAULT_BASE_URLS = Object.freeze({
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  ollama: 'http://127.0.0.1:11434',
});

/** Providers that will not work without a key. */
const NEEDS_KEY = new Set(['anthropic', 'openai', 'gemini']);

const trimSlash = (url) => String(url || '').replace(/\/+$/, '');

/**
 * Join a base URL with a versioned path. A user-supplied baseUrl that already
 * ends in `/v1` (the usual shape for an OpenAI-compatible endpoint) does not
 * get a second one.
 */
function apiUrl(base, versionedPath) {
  const b = trimSlash(base);
  return b.endsWith('/v1') ? `${b}${versionedPath.replace(/^\/v1/, '')}` : `${b}${versionedPath}`;
}

/* ================================================================== */
/*  Adapters                                                          */
/* ================================================================== */

const ADAPTERS = {
  anthropic: {
    request(cfg, model, { system, user, maxTokens }) {
      return {
        url: apiUrl(cfg.baseUrl || DEFAULT_BASE_URLS.anthropic, '/v1/messages'),
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
          }),
        },
      };
    },
    read: (json) => (json.content || []).map((c) => c.text || '').join('').trim(),
  },

  openai: {
    request(cfg, model, { system, user, maxTokens }) {
      return {
        url: apiUrl(cfg.baseUrl || DEFAULT_BASE_URLS.openai, '/v1/chat/completions'),
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_completion_tokens: maxTokens,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        },
      };
    },
    read: (json) =>
      ((json.choices || [])[0] || {}).message
        ? String(json.choices[0].message.content || '').trim()
        : '',
  },

  gemini: {
    request(cfg, model, { system, user, maxTokens }) {
      const base = trimSlash(cfg.baseUrl || DEFAULT_BASE_URLS.gemini);
      return {
        url: `${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        },
      };
    },
    read: (json) => {
      const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
      return parts.map((p) => p.text || '').join('').trim();
    },
  },

  ollama: {
    request(cfg, model, { system, user }) {
      return {
        url: `${trimSlash(cfg.baseUrl || DEFAULT_BASE_URLS.ollama)}/api/chat`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        },
      };
    },
    read: (json) => String((json.message || {}).content || '').trim(),
  },
};

// An OpenAI-compatible endpoint speaks the OpenAI wire format at a user-supplied base.
ADAPTERS['openai-compatible'] = ADAPTERS.openai;

/* ================================================================== */
/*  Public interface                                                  */
/* ================================================================== */

/** True when `ai.complete` will do something other than throw. */
export async function isConfigured() {
  const { ai } = await getConfig();
  if (!ai || ai.provider === 'none' || !ADAPTERS[ai.provider]) return false;
  if (NEEDS_KEY.has(ai.provider) && !ai.apiKey) return false;
  if (ai.provider === 'openai-compatible' && !ai.baseUrl) return false;
  return true;
}

function assertConfigured(ai) {
  const howToFix = 'Set an AI provider and key on the extension options page.';
  if (!ai || ai.provider === 'none' || !ADAPTERS[ai.provider]) {
    throw new EngineError(ERROR.AI_NOT_CONFIGURED, 'No AI provider is configured.', { howToFix });
  }
  if (NEEDS_KEY.has(ai.provider) && !ai.apiKey) {
    throw new EngineError(
      ERROR.AI_NOT_CONFIGURED,
      `No API key is configured for ${ai.provider}.`,
      { howToFix },
    );
  }
  if (ai.provider === 'openai-compatible' && !ai.baseUrl) {
    throw new EngineError(
      ERROR.AI_NOT_CONFIGURED,
      'An openai-compatible provider needs a baseUrl.',
      { howToFix },
    );
  }
}

/**
 * Run one task through the configured provider.
 *
 * @param {'opener'|'summary'|'sentiment'|'comment'|'score'} task
 * @param {object} input task-specific input (profile, message, brief, post, tone)
 * @returns {Promise<{output: string|object, provider: string, model: string}>}
 */
export async function complete(task, input = {}) {
  const { ai } = await getConfig();
  assertConfigured(ai);

  const adapter = ADAPTERS[ai.provider];
  const model = ai.model || DEFAULT_MODELS[ai.provider];
  const prompt = promptFor(task, input);
  const { url, init } = adapter.request(ai, model, prompt);

  let response;
  try {
    response = await fetch(url, init);
  } catch (e) {
    // Never echo the request: the URL may carry the key as a query parameter.
    throw new EngineError(ERROR.AI_ERROR, `Could not reach the ${ai.provider} API: ${e.message}`);
  }

  if (!response.ok) {
    throw new EngineError(
      ERROR.AI_ERROR,
      `The ${ai.provider} API returned ${response.status}.`,
      { howToFix: 'Check the key, the model name and any spending limit on the account.' },
    );
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new EngineError(ERROR.AI_ERROR, `The ${ai.provider} API returned a non-JSON response.`);
  }

  const text = adapter.read(json);
  if (!text) {
    throw new EngineError(ERROR.AI_ERROR, `The ${ai.provider} API returned an empty response.`);
  }

  return { output: parseOutput(task, text), provider: ai.provider, model };
}

register(ACTIONS.AI_COMPLETE, ({ task, input }) => complete(task, input));
