import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Webhooks } from '../src/webhooks.js';
import { MAX_COMPLETED_RESEARCH } from '../src/toolkit.js';
import { makeHarness, type Harness } from './helpers.js';

let harness: Harness | null = null;
let receiver: Server | null = null;

afterEach(async () => {
  await harness?.stop();
  harness = null;
  const server = receiver;
  receiver = null;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('bridge events', () => {
  it('are recorded in the events table', async () => {
    harness = await makeHarness();
    harness.ext.emit('invite_accepted', { publicId: 'ada-lovelace' });
    await new Promise((r) => setTimeout(r, 50));

    const rows = harness.toolkit.db.query('SELECT event, payload FROM events').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe('invite_accepted');
    expect(JSON.parse(rows[0].payload as string)).toEqual({ publicId: 'ada-lovelace' });
  });

  it('are delivered to the configured webhook', async () => {
    const bodies: any[] = [];
    receiver = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        bodies.push(JSON.parse(raw));
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => receiver!.listen(0, '127.0.0.1', () => resolve()));
    const port = (receiver!.address() as any).port;

    harness = await makeHarness();
    harness.toolkit.webhooks.setUrl(`http://127.0.0.1:${port}/hook`);
    harness.ext.emit('positive_reply', { threadId: 'thread_1' });

    await new Promise((r) => setTimeout(r, 50));
    await harness.toolkit.webhooks.drain();

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      event: 'positive_reply',
      payload: { threadId: 'thread_1' },
    });
    expect(typeof bodies[0].at).toBe('number');
  });

  it('let stop() return promptly even mid-retry against a dead receiver', async () => {
    harness = await makeHarness();
    harness.toolkit.webhooks.setUrl('http://127.0.0.1:1/nowhere');
    harness.ext.emit('quota_hit', { kind: 'invite' });
    // Long enough to be inside the first retry sleep.
    await new Promise((r) => setTimeout(r, 100));

    const startedAt = Date.now();
    await harness.stop();
    harness = null;
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('do not break the bridge when the webhook receiver is dead', async () => {
    harness = await makeHarness();
    harness.toolkit.webhooks.setUrl('http://127.0.0.1:1/nowhere');
    harness.ext.emit('quota_hit', { kind: 'invite' });
    await new Promise((r) => setTimeout(r, 50));

    // The bridge still answers normally.
    await expect(harness.toolkit.call('status.get', {})).resolves.toMatchObject({
      loggedIn: true,
    });
  });
});

describe('Toolkit.sync', () => {
  it('passes an explicit since through and still advances lastSyncAt', async () => {
    harness = await makeHarness();
    const result = await harness.toolkit.sync(12345);
    expect(result.since).toBe(12345);
    expect(harness.ext.seen.at(-1)?.params).toEqual({ since: 12345 });
    expect(harness.toolkit.db.lastSyncAt).toBe(result.syncedAt);
  });
});

describe('Toolkit.waitForResearch', () => {
  it('resolves immediately for a job that already completed', async () => {
    harness = await makeHarness();
    harness.ext.emit('research_completed', { jobId: 'early' });
    await new Promise((r) => setTimeout(r, 30));
    await expect(harness.toolkit.waitForResearch('early', 50)).resolves.toBe(true);
  });

  it('resolves false when the job never completes', async () => {
    harness = await makeHarness();
    await expect(harness.toolkit.waitForResearch('never', 30)).resolves.toBe(false);
  });

  it('does not remember unclaimed completions without bound', async () => {
    harness = await makeHarness();
    for (let i = 0; i < MAX_COMPLETED_RESEARCH + 50; i++) {
      harness.ext.emit('research_completed', { jobId: `job_${i}` });
    }
    await new Promise((r) => setTimeout(r, 200));
    // Reading any job id triggers the prune.
    await harness.toolkit.waitForResearch('nothing', 1);
    const remembered = (harness.toolkit as any).researchCompleted as Map<string, number>;
    expect(remembered.size).toBeLessThanOrEqual(MAX_COMPLETED_RESEARCH);
  });
});

describe('Webhooks defaults', () => {
  it('are off until a url is configured', () => {
    expect(new Webhooks().configured).toBe(false);
    expect(new Webhooks({ url: 'http://127.0.0.1:1/x' }).configured).toBe(true);
  });
});
