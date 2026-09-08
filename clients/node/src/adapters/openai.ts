/**
 * OpenAI adapters.
 *
 * Two surfaces, two shapes. Chat Completions and the Assistants API want
 * `{ type: 'function', function: { name, description, parameters } }` with a
 * JSON Schema — that is `toOpenAITools`. The Agents SDK's `tool()` wants
 * `{ name, description, parameters (zod), execute }` — that is
 * `toOpenAIAgentsTools`. Handing either one the other's shape fails quietly, so
 * both are here rather than leaving the caller to reshape.
 */
import type { z } from 'zod';
import type { LinkedInToolkit } from '../client.js';
import { LinkedInToolkitError } from '../errors.js';
import type { ToolDefinition } from '../types.js';
import { filterTools, zodSchemaForTool, type ToolFilter } from './shared.js';

export type OpenAIFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * A tool call as either OpenAI surface reports it. Chat Completions sends
 * `{ id, function: { name, arguments } }`; the Responses API sends
 * `{ call_id, name, arguments }`. Both are accepted.
 */
export type OpenAIToolCall =
  | { id?: string; type?: string; function: { name: string; arguments?: string | null } }
  | { call_id?: string; type?: string; name: string; arguments?: string | null };

export function toOpenAITools(
  client: LinkedInToolkit,
  filter?: ToolFilter,
): OpenAIFunctionTool[] {
  return filterTools(client.tools(), filter).map(
    (tool: ToolDefinition): OpenAIFunctionTool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }),
  );
}

function readCall(call: OpenAIToolCall): { name: string; args: Record<string, unknown> } {
  const name = 'function' in call && call.function ? call.function.name : (call as { name: string }).name;
  const raw =
    'function' in call && call.function
      ? call.function.arguments
      : (call as { arguments?: string | null }).arguments;

  if (typeof name !== 'string' || !name) {
    throw new LinkedInToolkitError({
      code: 'INVALID_PARAMS',
      message: 'The tool call has no function name.',
    });
  }

  if (raw === undefined || raw === null || raw === '') return { name, args: {} };
  if (typeof raw === 'object') return { name, args: raw as Record<string, unknown> };

  try {
    const parsed = JSON.parse(raw);
    return { name, args: parsed && typeof parsed === 'object' ? parsed : {} };
  } catch (cause) {
    throw new LinkedInToolkitError(
      {
        code: 'INVALID_PARAMS',
        message: `The arguments for ${name} are not valid JSON.`,
        howToFix: 'Ask the model to call the tool again with valid JSON arguments.',
      },
      { action: name, cause },
    );
  }
}

/**
 * Run one tool call the model produced. Resolves with the action's `data`;
 * rejects with a `LinkedInToolkitError` so a caller can decide whether to feed
 * the failure back to the model (`error.toJSON()`) or stop, which for a
 * terminal code (`error.terminal`) is the only correct answer.
 */
export async function runOpenAIToolCall(
  client: LinkedInToolkit,
  call: OpenAIToolCall,
): Promise<unknown> {
  const { name, args } = readCall(call);
  return client.callTool(name, args);
}

/**
 * The OpenAI **Agents SDK** takes a different shape from the raw API: `tool()`
 * wants `{ name, description, parameters (zod), execute }`, not
 * `{ type: 'function', function: {...} }`.
 *
 * `strict: false` is set deliberately. Strict mode requires every property to
 * be required, and most actions here have genuinely optional filters; the
 * alternative would be rewriting every `.optional()` as `.nullable()` and
 * teaching the model to send nulls.
 */
export type OpenAIAgentsTool = {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  strict: false;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

export function toOpenAIAgentsTools(
  client: LinkedInToolkit,
  filter?: ToolFilter,
): OpenAIAgentsTool[] {
  return filterTools(client.tools(), filter).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: zodSchemaForTool(tool.name),
    strict: false as const,
    execute: (args: Record<string, unknown> = {}) => client.callTool(tool.name, args),
  }));
}
