import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Webhooks, RETRY_DELAYS_MS } from '../src/webhooks.js';

let server: Server | null = null;

afterEach(async () => {
  const s = server;
  server = null;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
});

type Received = { body: any; headers: Record<string, unknown> };

async function receiver(
  respond: (attempt: number) => number,
): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  let attempt = 0;
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({ body: JSON.parse(raw || '{}'), headers: req.headers as any });
      res.writeHead(respond(attempt++)).end();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const port = (server!.address() as any).port;
  return { url: `http://127.0.0.1:${port}/hook`, received };
}

describe('Webhooks', () => {
  it('does nothing when no url is configured', async () => {
    const hooks = new Webhooks();
    expect(hooks.configured).toBe(false);
    hooks.deliver('reply_received', { threadId: 't1' });
    await hooks.drain();
  });

  it('POSTs {event, payload, at} as JSON', async () => {
    const { url, received } = await receiver(() => 200);
    const hooks = new Webhooks({ url });
    hooks.deliver('reply_received', { threadId: 't1' }, 1234);
    await hooks.drain();

    expect(received).toHaveLength(1);
    expect(received[0].body).toEqual({
      event: 'reply_received',
      payload: { threadId: 't1' },
      at: 1234,
    });
    expect(received[0].headers['content-type']).toContain('application/json');
  });

  it('retries three times at 1s, 5s and 25s then gives up', async () => {
    const { url, received } = await receiver(() => 500);
    const slept: number[] = [];
    const hooks = new Webhooks({
      url,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    hooks.deliver('quota_hit', { kind: 'invite' });
    await hooks.drain();

    expect(received).toHaveLength(4);
    expect(slept).toEqual(RETRY_DELAYS_MS);
  });

  it('stops retrying as soon as a delivery succeeds', async () => {
    const { url, received } = await receiver((attempt) => (attempt === 0 ? 503 : 204));
    const slept: number[] = [];
    const hooks = new Webhooks({
      url,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    hooks.deliver('invite_accepted', { publicId: 'ada-lovelace' });
    await hooks.drain();

    expect(received).toHaveLength(2);
    expect(slept).toEqual([1000]);
  });

  it('never throws when the receiver is unreachable', async () => {
    const errors: unknown[] = [];
    const hooks = new Webhooks({
      url: 'http://127.0.0.1:1/nowhere',
      sleep: async () => undefined,
      onError: (err) => errors.push(err),
    });
    hooks.deliver('challenge_detected', {});
    await expect(hooks.drain()).resolves.toBeUndefined();
    expect(errors).toHaveLength(4);
  });

  it('cuts a retry sleep short when closed', async () => {
    const { url } = await receiver(() => 500);
    // A real (unfaked) sleep ladder: only close() can end this quickly.
    const hooks = new Webhooks({ url, retryDelaysMs: [30_000, 30_000, 30_000] });
    hooks.deliver('quota_hit', {});
    await new Promise((r) => setTimeout(r, 50));

    const startedAt = Date.now();
    hooks.close();
    await hooks.drain();
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('drops deliveries queued after close', async () => {
    const { url, received } = await receiver(() => 200);
    const hooks = new Webhooks({ url });
    hooks.close();
    hooks.deliver('quota_hit', {});
    await hooks.drain();
    expect(received).toHaveLength(0);
  });

  it('can be pointed at a new url at runtime', async () => {
    const { url, received } = await receiver(() => 200);
    const hooks = new Webhooks();
    hooks.deliver('quota_hit', {});
    await hooks.drain();
    expect(received).toHaveLength(0);

    hooks.setUrl(url);
    hooks.deliver('quota_hit', {});
    await hooks.drain();
    expect(received).toHaveLength(1);
  });
});
