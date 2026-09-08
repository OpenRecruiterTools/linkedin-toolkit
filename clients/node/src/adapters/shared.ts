/**
 * Shared plumbing for the three adapters: which tools to expose, and the zod
 * schema behind each one.
 */
import type { z } from 'zod';
import { toolByName, toolInputSchema } from '../contract.js';
import type { ToolDefinition } from '../types.js';

/**
 * Narrow the tool set handed to a model. The three are applied in order and
 * compose: `include` selects, then `exclude` removes from that selection, then
 * `readOnly` drops every tool that writes to LinkedIn — which is the cheapest
 * way to build a sourcing agent that structurally cannot send anything.
 */
export type ToolFilter = {
  include?: string[];
  exclude?: string[];
  readOnly?: boolean;
};

export function filterTools(tools: ToolDefinition[], filter?: ToolFilter): ToolDefinition[] {
  if (!filter) return tools;
  let selected = tools;
  if (filter.include) {
    const wanted = new Set(filter.include);
    selected = selected.filter((tool) => wanted.has(tool.name));
  }
  if (filter.exclude) {
    const unwanted = new Set(filter.exclude);
    selected = selected.filter((tool) => !unwanted.has(tool.name));
  }
  if (filter.readOnly) selected = selected.filter((tool) => !tool.write);
  return selected;
}

/**
 * The zod schema for a tool's arguments, straight from the copied contract, so
 * the frameworks that want zod and the frameworks that want JSON Schema are
 * describing exactly the same thing.
 */
export function zodSchemaForTool(name: string): z.ZodObject<z.ZodRawShape> {
  const tool = toolByName(name);
  if (!tool) throw new Error(`Unknown tool "${name}".`);
  return toolInputSchema(tool);
}
