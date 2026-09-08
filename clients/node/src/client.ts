/**
 * The client. One HTTP call per action, no state, no retries.
 *
 * Retries are deliberately absent. Half of the error codes this API returns are
 * terminal (`RATE_LIMITED`, `QUOTA_EXCEEDED`, `CHALLENGE_DETECTED`) and retrying
 * them is the behaviour that gets a LinkedIn account restricted. A client that
 * retried on the caller's behalf would be doing the one thing the whole project
 * exists to prevent.
 */
import { isAction } from './contract.js';
import { resolveConfig, normaliseBaseUrl, type ResolvedConfig } from './config.js';
import { LinkedInToolkitError } from './errors.js';
import { GeneratedActions } from './methods.js';
import { TOOL_DEFINITIONS, TOOLS_VERSION } from './tools.generated.js';
import type {
  ActionName,
  Envelope,
  Health,
  LinkedInToolkitOptions,
  ParamsOf,
  ResultOf,
  ToolDefinition,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * `POST /tools/linkedin_research_pack` does not return a job id — the server
 * waits for the job to finish, up to its `researchTimeoutMs` (10 minutes by
 * default) before falling back to polling. A 120 s client timeout would abandon
 * a run the server is still doing perfectly well, so this one tool gets a
 * budget wider than the server's own.
 *
 * `client.researchPack(...)` (the action, not the tool) returns immediately
 * with a job id and is unaffected.
 */
const RESEARCH_PACK_TOOL = 'linkedin_research_pack';
const RESEARCH_PACK_TIMEOUT_MS = 660_000;

export class LinkedInToolkit extends GeneratedActions {
  readonly baseUrl: string;
  readonly config: ResolvedConfig;
  private readonly token: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: LinkedInToolkitOptions = {}) {
    super();
    this.config = resolveConfig({ baseUrl: options.baseUrl, token: options.token });
    this.baseUrl = this.config.baseUrl;
    this.token = this.config.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('No fetch implementation available. Node 20 or newer is required.');
    }
  }

  /**
   * Call an action. Resolves with the envelope's `data`; rejects with a
   * `LinkedInToolkitError` for anything else, including transport failures.
   */
  async call<A extends ActionName>(action: A, params?: ParamsOf<A>): Promise<ResultOf<A>> {
    if (!isAction(action)) {
      throw new LinkedInToolkitError(
        {
          code: 'NOT_FOUND',
          message: `Unknown action "${action}".`,
          howToFix: 'client.tools() lists every tool; docs/actions.md lists every action.',
        },
        { action: String(action) },
      );
    }
    return (await this.post(`/actions/${action}`, params ?? {}, action)) as ResultOf<A>;
  }

  /**
   * Call one of the 39 MCP tools by name. Use this for the three that are not a
   * bare action — `linkedin_query_sql`, `linkedin_sync` and
   * `linkedin_research_pack` — and whenever you are working from tool names
   * rather than action names, which is what every adapter in this package does.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const timeoutMs =
      name === RESEARCH_PACK_TOOL ? Math.max(this.timeoutMs, RESEARCH_PACK_TIMEOUT_MS) : this.timeoutMs;
    return this.post(`/tools/${name}`, args, name, timeoutMs);
  }

  /** `GET /health`. No token required, so this works before pairing. */
  async health(): Promise<Health> {
    const response = await this.request('GET', '/health');
    return (await response.json()) as Health;
  }

  /**
   * The 39 tool definitions the server advertises, with JSON Schema parameters.
   * Static data generated from `mcp-server/tools.json` — no network call, so it
   * works with the server stopped.
   *
   * Deep-copied: the definitions are module-level constants and the schemas
   * nest several levels, so a shallow copy would let a caller who edited
   * `parameters.properties.steps` change what every later caller sees.
   */
  tools(): ToolDefinition[] {
    return structuredClone(TOOL_DEFINITIONS);
  }

  /** The contract version these tool definitions were generated from. */
  get toolsVersion(): string {
    return TOOLS_VERSION;
  }

  private async post(
    path: string,
    body: unknown,
    action: string,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    const response = await this.request('POST', path, body, action, timeoutMs);

    let envelope: Envelope;
    try {
      envelope = (await response.json()) as Envelope;
    } catch (cause) {
      throw new LinkedInToolkitError(
        {
          code: 'INTERNAL',
          message: `${this.baseUrl}${path} returned ${response.status} with a body that is not JSON.`,
        },
        { action, cause },
      );
    }

    if (envelope && envelope.ok === true) return envelope.data;

    if (envelope && envelope.ok === false && envelope.error) {
      throw new LinkedInToolkitError(envelope.error, { action });
    }

    throw new LinkedInToolkitError(
      {
        code: 'INTERNAL',
        message: `${this.baseUrl}${path} returned ${response.status} with an unrecognised body.`,
      },
      { action },
    );
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    action?: string,
    timeoutMs = this.timeoutMs,
  ): Promise<Response> {
    const url = `${normaliseBaseUrl(this.baseUrl)}${path}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      const aborted = controller.signal.aborted;
      throw new LinkedInToolkitError(
        {
          code: aborted ? 'INTERNAL' : 'EXTENSION_OFFLINE',
          message: aborted
            ? `${method} ${url} timed out after ${timeoutMs} ms.`
            : `Cannot reach the LinkedIn Toolkit server at ${this.baseUrl}.`,
          howToFix: aborted
            ? 'Raise timeoutMs, or check the extension is still attached with client.health().'
            : 'Start it with `lit serve --http`, or set LINKEDIN_TOOLKIT_URL if it is on another port.',
        },
        { action, cause },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
