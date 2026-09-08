/**
 * Outbound webhooks: every bridge event is POSTed to the configured URL as
 * `{ event, payload, at }`, retried at 1 s, 5 s and 25 s.
 *
 * Delivery is fire-and-forget. A webhook failure must never turn into a bridge
 * failure, so nothing here is ever thrown back at the caller.
 */
export const RETRY_DELAYS_MS = [1000, 5000, 25_000];

export type WebhookDelivery = {
  event: string;
  payload: unknown;
  at: number;
};

export type WebhookOptions = {
  url?: string;
  retryDelaysMs?: number[];
  fetchImpl?: typeof fetch;
  onError?: (err: unknown, attempt: number) => void;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

export class Webhooks {
  private url?: string;
  private readonly retryDelaysMs: number[];
  private readonly fetchImpl: typeof fetch;
  private readonly onError?: (err: unknown, attempt: number) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Resolves when every in-flight delivery has settled (tests await this). */
  private inflight = new Set<Promise<void>>();

  constructor(options: WebhookOptions = {}) {
    this.url = options.url;
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onError = options.onError;
    this.sleep = options.sleep ?? defaultSleep;
  }

  setUrl(url: string | undefined): void {
    this.url = url;
  }

  get configured(): boolean {
    return Boolean(this.url);
  }

  /** Queue a delivery. Returns immediately; never rejects. */
  deliver(event: string, payload: unknown, at = Date.now()): void {
    if (!this.url) return;
    const task = this.send({ event, payload, at }).catch(() => undefined);
    this.inflight.add(task);
    void task.finally(() => this.inflight.delete(task));
  }

  async drain(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.all([...this.inflight]);
    }
  }

  private async send(delivery: WebhookDelivery): Promise<void> {
    const url = this.url;
    if (!url) return;
    const body = JSON.stringify(delivery);
    const attempts = this.retryDelaysMs.length + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
        if (response.ok) return;
        throw new Error(`webhook responded ${response.status}`);
      } catch (err) {
        this.onError?.(err, attempt);
        const delay = this.retryDelaysMs[attempt];
        if (delay === undefined) return;
        await this.sleep(delay);
      }
    }
  }
}
