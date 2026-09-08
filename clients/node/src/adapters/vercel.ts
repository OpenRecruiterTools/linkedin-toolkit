/**
 * Vercel AI SDK adapter.
 *
 * AI SDK 5 renamed `parameters` to `inputSchema` and a v4-shaped tool silently
 * never fires, which is the single most common way this integration breaks.
 * Each tool object here carries **both** keys pointing at the same zod schema,
 * so the same record works on v4 and v5 without the caller choosing a branch.
 *
 * `ai` is an optional peer dependency and is deliberately not imported: the
 * SDK's `tool()` helper is an identity function that exists only for type
 * inference, so building the object directly loses nothing at runtime and keeps
 * this package installable without `ai`.
 */
import type { z } from 'zod';
import type { LinkedInToolkit } from '../client.js';
import { filterTools, zodSchemaForTool, type ToolFilter } from './shared.js';

export type VercelAITool = {
  description: string;
  /** AI SDK v4 reads this. */
  parameters: z.ZodObject<z.ZodRawShape>;
  /** AI SDK v5 reads this. Same schema. */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

export function toVercelAITools(
  client: LinkedInToolkit,
  filter?: ToolFilter,
): Record<string, VercelAITool> {
  const tools: Record<string, VercelAITool> = {};
  for (const tool of filterTools(client.tools(), filter)) {
    const schema = zodSchemaForTool(tool.name);
    tools[tool.name] = {
      description: tool.description,
      parameters: schema,
      inputSchema: schema,
      execute: (args: Record<string, unknown> = {}) => client.callTool(tool.name, args),
    };
  }
  return tools;
}
