/**
 * One error type for every failure this client can produce, so a caller never
 * has to tell a transport failure apart from an engine failure by inspecting
 * strings.
 */
import { ERROR_CODES } from './contract.js';
import type { ErrorShape } from './types.js';

export { ERROR_CODES } from './contract.js';
export type { ErrorCode } from './contract.js';

/**
 * Codes that must not be retried. Retrying after a challenge is the specific
 * behaviour that turns a LinkedIn warning into a restriction, so this set is
 * exported rather than left for each caller to rediscover.
 */
export const TERMINAL_ERROR_CODES: ReadonlySet<string> = new Set([
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'CHALLENGE_DETECTED',
  'NOT_LOGGED_IN',
]);

export class LinkedInToolkitError extends Error {
  /** One of `ERROR_CODES`, or `INTERNAL` for anything the server did not name. */
  readonly code: string;
  /** What the user should do about it, when the server said. */
  readonly howToFix?: string;
  /** Milliseconds to wait, when the server said. Never a licence to sleep-and-loop. */
  readonly retryAfter?: number;
  /** The action or tool that failed, when the failure came from a call. */
  readonly action?: string;

  constructor(
    error: ErrorShape,
    options: { action?: string; cause?: unknown } = {},
  ) {
    super(error.message);
    this.name = 'LinkedInToolkitError';
    this.code = error.code;
    this.howToFix = error.howToFix;
    this.retryAfter = error.retryAfter;
    this.action = options.action;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  /** True when retrying is the wrong response. See `TERMINAL_ERROR_CODES`. */
  get terminal(): boolean {
    return TERMINAL_ERROR_CODES.has(this.code);
  }

  /** True when the code is one the contract defines. */
  get known(): boolean {
    return (ERROR_CODES as readonly string[]).includes(this.code);
  }

  /** The shape an agent framework can hand back to a model as a tool result. */
  toJSON(): ErrorShape & { action?: string } {
    return {
      code: this.code,
      message: this.message,
      ...(this.howToFix ? { howToFix: this.howToFix } : {}),
      ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      ...(this.action ? { action: this.action } : {}),
    };
  }
}
