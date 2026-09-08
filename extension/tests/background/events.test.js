import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EVENTS } from '../../src/lib/actions.js';
import * as events from '../../src/background/events.js';

beforeEach(() => {
  events.setSink(null);
});

describe('events.emit', () => {
  it('hands the frame to the sink', async () => {
    const sink = vi.fn();
    events.setSink(sink);
    await events.emit(EVENTS.REPLY_RECEIVED, { threadId: 't1' });
    expect(sink).toHaveBeenCalledWith({
      event: 'reply_received',
      payload: { threadId: 't1' },
    });
  });

  it('never throws when the sink throws', async () => {
    events.setSink(() => {
      throw new Error('bridge down');
    });
    await expect(events.emit(EVENTS.QUOTA_HIT, {})).resolves.toBeTruthy();
  });

  it('rejects unknown event names', async () => {
    await expect(events.emit('not_an_event', {})).rejects.toThrow(/unknown event/i);
  });

  it('records the event in the log with updatedAt for sync.pull', async () => {
    await events.emit(EVENTS.CAMPAIGN_STEP_DONE, { campaignId: 'c1' });
    const log = await events.recent(0);
    expect(log).toHaveLength(1);
    expect(log[0].event).toBe('campaign_step_done');
    expect(typeof log[0].updatedAt).toBe('number');
  });

  it('recent filters on updatedAt', async () => {
    await events.emit(EVENTS.CAMPAIGN_STEP_DONE, { a: 1 });
    const future = Date.now() + 10_000;
    expect(await events.recent(future)).toEqual([]);
  });
});

describe('notifications', () => {
  it.each([
    EVENTS.CHALLENGE_DETECTED,
    EVENTS.QUOTA_HIT,
    EVENTS.POSITIVE_REPLY,
  ])('raises a chrome notification for %s', async (name) => {
    await events.emit(name, {});
    expect(chrome.__mock.notifications).toHaveLength(1);
    expect(chrome.__mock.notifications[0].options.title).toBeTruthy();
  });

  it('does not notify for routine events', async () => {
    await events.emit(EVENTS.QUEUE_ITEM_ADDED, {});
    expect(chrome.__mock.notifications).toHaveLength(0);
  });
});
