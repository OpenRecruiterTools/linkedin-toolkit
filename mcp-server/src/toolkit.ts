/**
 * The shared core behind every surface: MCP tools, the HTTP action API and the
 * CLI all go through one `Toolkit` instance, so they cannot drift apart.
 */
import { BridgeServer, BridgeError, type BridgeOptions } from './bridge.js';
import { Db } from './db.js';
import { Webhooks } from './webhooks.js';
import type { ServerConfig } from './config.js';
import type { ActionName, EventName } from './contract.js';

export type ToolkitOptions = {
  config: ServerConfig;
  bridge?: BridgeServer;
  db?: Db;
  webhooks?: Webhooks;
  bridgeOptions?: Partial<BridgeOptions>;
};

export type SyncResult = {
  since: number;
  syncedAt: number;
  counts: Record<string, number>;
  totals: Record<string, number>;
};

export type ResearchPackResult =
  | { jobId: string; status: 'completed'; done: number; total: number; packs: unknown[] }
  | { jobId: string; status: 'running'; total: number; etaMs?: number; note: string };

export class Toolkit {
  readonly config: ServerConfig;
  readonly bridge: BridgeServer;
  readonly db: Db;
  readonly webhooks: Webhooks;

  private researchWaiters = new Map<string, (() => void)[]>();
  private researchCompleted = new Set<string>();

  constructor(options: ToolkitOptions) {
    this.config = options.config;
    this.bridge =
      options.bridge ??
      new BridgeServer({
        port: options.config.bridgePort,
        token: options.config.token,
        ...options.bridgeOptions,
      });
    this.db = options.db ?? new Db(options.config.dbPath);
    this.webhooks = options.webhooks ?? new Webhooks({ url: options.config.webhookUrl });

    this.bridge.on('event', (event: EventName, payload: unknown) => {
      this.db.upsertEvent({ event, payload, at: Date.now() });
      this.webhooks.deliver(event, payload);
      if (event === 'research_completed') {
        const jobId = (payload as any)?.jobId;
        if (typeof jobId === 'string') this.resolveResearch(jobId);
      }
    });
  }

  async start(): Promise<void> {
    await this.bridge.start();
  }

  async stop(): Promise<void> {
    await this.bridge.stop();
    this.webhooks.close();
    await this.webhooks.drain();
    this.db.close();
  }

  isConnected(): boolean {
    return this.bridge.isConnected();
  }

  /** Call an action on the extension and mirror whatever it returns. */
  async call(
    action: ActionName,
    params: unknown = {},
    options: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    const data = await this.bridge.request(action, params, options);
    this.db.recordToolResult(action, data);
    return data;
  }

  /** `sync.pull` since the last sync, applied to the local mirror. */
  async sync(since?: number): Promise<SyncResult> {
    const from = since ?? this.db.lastSyncAt;
    const startedAt = Date.now();
    const payload = (await this.bridge.request('sync.pull', { since: from })) as any;
    const counts = this.db.upsertSync(payload, startedAt);
    this.db.lastSyncAt = startedAt;
    return {
      since: from,
      syncedAt: startedAt,
      counts: counts as Record<string, number>,
      totals: this.db.counts(),
    };
  }

  /**
   * Start a research job and wait for it. Returns the finished packs, or the
   * job id when the job outlives `timeoutMs` so the caller can poll
   * `research.get`.
   */
  async researchPack(
    params: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<ResearchPackResult> {
    const timeoutMs = options.timeoutMs ?? this.config.researchTimeoutMs;
    const started = (await this.call('research.pack', params)) as any;
    const jobId = String(started?.jobId ?? '');
    if (!jobId) {
      throw new BridgeError('INTERNAL', 'The extension did not return a research job id.');
    }

    const finished = await this.waitForResearch(jobId, timeoutMs);
    if (!finished) {
      return {
        jobId,
        status: 'running',
        total: Number(started?.total ?? 0),
        etaMs: started?.etaMs,
        note: `Research is still running after ${timeoutMs}ms. Poll linkedin_research_get with jobId "${jobId}".`,
      };
    }

    const result = (await this.call('research.get', { jobId })) as any;
    return {
      jobId,
      status: 'completed',
      done: Number(result?.done ?? 0),
      total: Number(result?.total ?? 0),
      packs: Array.isArray(result?.packs) ? result.packs : [],
    };
  }

  /** Resolves true when the job completes, false on timeout. */
  waitForResearch(jobId: string, timeoutMs: number): Promise<boolean> {
    if (this.researchCompleted.has(jobId)) {
      this.researchCompleted.delete(jobId);
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.removeWaiter(jobId, onDone);
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
      const onDone = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const waiters = this.researchWaiters.get(jobId) ?? [];
      waiters.push(onDone);
      this.researchWaiters.set(jobId, waiters);
    });
  }

  private resolveResearch(jobId: string): void {
    const waiters = this.researchWaiters.get(jobId);
    this.researchWaiters.delete(jobId);
    if (!waiters || waiters.length === 0) {
      this.researchCompleted.add(jobId);
      return;
    }
    for (const waiter of waiters) waiter();
  }

  private removeWaiter(jobId: string, waiter: () => void): void {
    const waiters = this.researchWaiters.get(jobId);
    if (!waiters) return;
    const next = waiters.filter((w) => w !== waiter);
    if (next.length === 0) this.researchWaiters.delete(jobId);
    else this.researchWaiters.set(jobId, next);
  }
}
