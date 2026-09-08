/**
 * OpenAI adapter — the `tools` array for Chat Completions, the Assistants API
 * and the OpenAI Agents SDK, all of which take the same
 * `{ type: 'function', function: { name, description, parameters } }` shape.
 */
import type { LinkedInToolkit } from '../client.js';
import { LinkedInToolkitError } from '../errors.js';
import type { ToolDefinition } from '../types.js';
import { filterTools, type ToolFilter } from './shared.js';

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
