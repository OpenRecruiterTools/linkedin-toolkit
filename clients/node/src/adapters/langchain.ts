/**
 * LangChain.js adapter.
 *
 * `@langchain/core` is an optional peer dependency, so it is imported lazily
 * and `toLangChainTools` is therefore async — the one place in this package
 * where the shape had to bend to keep the dependency optional. If you would
 * rather construct the tools yourself, `toLangChainToolSpecs` is synchronous
 * and hands back everything `new DynamicStructuredTool(...)` needs.
 */
import type { z } from 'zod';
import type { LinkedInToolkit } from '../client.js';
import { filterTools, zodSchemaForTool, type ToolFilter } from './shared.js';

export type LangChainToolSpec = {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  func: (args: Record<string, unknown>) => Promise<string>;
};

/**
 * Synchronous, dependency-free description of each tool. LangChain tools return
 * a string to the model, so `func` serialises the result; a caller who wants
 * the object can use `client.callTool` directly.
 */
export function toLangChainToolSpecs(
  client: LinkedInToolkit,
  filter?: ToolFilter,
): LangChainToolSpec[] {
  return filterTools(client.tools(), filter).map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: zodSchemaForTool(tool.name),
    func: async (args: Record<string, unknown> = {}) =>
      JSON.stringify(await client.callTool(tool.name, args)),
  }));
}

/** `DynamicStructuredTool[]`, ready for `createReactAgent` or `bindTools`. */
export async function toLangChainTools(
  client: LinkedInToolkit,
  filter?: ToolFilter,
): Promise<unknown[]> {
  let tools: { DynamicStructuredTool: new (fields: unknown) => unknown };
  try {
    tools = (await import('@langchain/core/tools')) as unknown as typeof tools;
  } catch (cause) {
    throw new Error(
      'toLangChainTools() needs @langchain/core. Install it with `npm i @langchain/core`, ' +
        'or use toLangChainToolSpecs() which has no dependencies.',
      { cause },
    );
  }

  return toLangChainToolSpecs(client, filter).map(
    (spec) =>
      new tools.DynamicStructuredTool({
        name: spec.name,
        description: spec.description,
        schema: spec.schema,
        func: spec.func,
      }),
  );
}
