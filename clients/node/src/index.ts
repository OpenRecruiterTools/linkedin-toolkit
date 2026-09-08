/**
 * linkedin-toolkit — the Node client for the LinkedIn Toolkit local HTTP API.
 *
 *   import { LinkedInToolkit, toOpenAITools } from 'linkedin-toolkit';
 *
 *   const client = new LinkedInToolkit();          // reads ~/.linkedin-toolkit
 *   const { profiles } = await client.searchPeople({ keywords: 'CTO fintech' });
 *
 * Writes return `{ status: 'queued' }` while Copilot mode is on. That is
 * success: a human approves them in the extension popup.
 */
export { LinkedInToolkit } from './client.js';
export { LinkedInToolkitError, TERMINAL_ERROR_CODES, ERROR_CODES } from './errors.js';
export type { ErrorCode } from './errors.js';
export {
  DEFAULT_BASE_URL,
  normaliseBaseUrl,
  resolveConfig,
  toolkitHome,
  type ResolvedConfig,
} from './config.js';
export { ACTION_METHODS } from './methods.js';
export { TOOL_DEFINITIONS, TOOLS_VERSION } from './tools.generated.js';

export { toOpenAITools, toOpenAIAgentsTools, runOpenAIToolCall } from './adapters/openai.js';
export type { OpenAIAgentsTool, OpenAIFunctionTool, OpenAIToolCall } from './adapters/openai.js';
export { toVercelAITools } from './adapters/vercel.js';
export type { VercelAITool } from './adapters/vercel.js';
export { toLangChainTools, toLangChainToolSpecs } from './adapters/langchain.js';
export type { LangChainToolSpec } from './adapters/langchain.js';
export { zodSchemaForTool, filterTools } from './adapters/shared.js';
export type { ToolFilter } from './adapters/shared.js';

export type {
  ActionName,
  Envelope,
  ErrorShape,
  Health,
  LinkedInToolkitOptions,
  ParamsOf,
  RateLimit,
  ResultOf,
  ToolDefinition,
} from './types.js';

export {
  ACTIONS,
  EVENTS,
  TOOLS,
  TOOL_NAMES,
  WRITE_ACTIONS,
  isAction,
  isWriteAction,
  toolByName,
  toolInputSchema,
} from './contract.js';
export type {
  Campaign,
  Company,
  Config,
  ListMember,
  ListRecord,
  Pack,
  Profile,
  QueueItem,
  ResearchRow,
  ResolvedRow,
  Status,
  Step,
  Thread,
  WriteResult,
} from './contract.js';
