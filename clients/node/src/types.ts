/**
 * The types the rest of the package is built from. Everything here is derived
 * from the generated `contract.ts`, so there is no second definition of the
 * action table anywhere in this package.
 */
import type { z } from 'zod';
import { PARAMS, RESULTS } from './contract.js';

export type { ActionName } from './contract.js';
import type { ActionName } from './contract.js';

/** Params accepted by an action, inferred from the contract's zod schema. */
export type ParamsOf<A extends ActionName> = z.infer<(typeof PARAMS)[A]>;

/** The `data` an action returns, inferred from the contract's zod schema. */
export type ResultOf<A extends ActionName> = A extends keyof typeof RESULTS
  ? z.infer<(typeof RESULTS)[A]>
  : unknown;

/** A tool definition as the MCP server advertises it. */
export type ToolDefinition = {
  name: string;
  /** The action this tool proxies, or `null` for the three server-local tools. */
  action: string | null;
  description: string;
  write: boolean;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
};

/** The error half of the envelope, exactly as the server sends it. */
export type ErrorShape = {
  code: string;
  message: string;
  retryAfter?: number;
  howToFix?: string;
};

/** How much of the relevant quota is left, when the server reports it. */
export type RateLimit = {
  hourlyUsed: number;
  hourlyCap: number;
  dailyUsed: number;
  dailyCap: number;
  nextAllowedAt: number;
};

/** The response envelope of `POST /actions/{action}` and `POST /tools/{tool}`. */
export type Envelope<T = unknown> =
  | { id: string; ok: true; data: T; rateLimit?: RateLimit }
  | { id: string; ok: false; error: ErrorShape };

/** `GET /health`. */
export type Health = {
  ok: boolean;
  extensionConnected: boolean;
  version: string;
};

/** Constructor options. Everything is optional; see `resolveConfig`. */
export type LinkedInToolkitOptions = {
  /** e.g. `http://127.0.0.1:47830`. */
  baseUrl?: string;
  /** The pairing token from `~/.linkedin-toolkit/config.json`. */
  token?: string;
  /** Per-request timeout in milliseconds. Default 120000. */
  timeoutMs?: number;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
};
