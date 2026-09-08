import { describe, expect, it } from 'vitest';
import type { IWebhookFunctions } from 'n8n-workflow';

import {
  EVENTS,
  LinkedInToolkitTrigger,
  shouldTrigger,
} from '../nodes/LinkedInToolkitTrigger/LinkedInToolkitTrigger.node';
import { makeWebhookContext } from './helpers';

const node = new LinkedInToolkitTrigger();

async function receive(body: unknown, parameters: Record<string, unknown> = {}) {
  return node.webhook.call(
    makeWebhookContext(body, parameters) as unknown as IWebhookFunctions,
  );
}

describe('the trigger description', () => {
  it('registers a POST webhook that answers on receipt', () => {
    expect(node.description.webhooks).toEqual([
      { name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' },
    ]);
    expect(node.description.inputs).toEqual([]);
    expect(node.description.outputs).toEqual(['main']);
  });

  it('offers all eleven contract events, each with a description', () => {
    const events = node.description.properties.find((property) => property.name === 'events')!;
    const options = events.options as Array<{ value: string; description: string }>;
    expect(options.map((option) => option.value)).toEqual([...EVENTS]);
    expect(options).toHaveLength(11);
    for (const option of options) expect(option.description.length).toBeGreaterThan(10);
  });

  it('tells the user how to point the server at this URL', () => {
    const notice = node.description.properties.find((property) => property.type === 'notice')!;
    expect(notice.displayName).toContain('lit config set webhookUrl');
  });
});

describe('the event filter', () => {
  it('passes everything when nothing is selected', () => {
    for (const event of EVENTS) expect(shouldTrigger(event, [])).toBe(true);
  });

  it('passes only the selected events', () => {
    expect(shouldTrigger('invite_accepted', ['invite_accepted', 'positive_reply'])).toBe(true);
    expect(shouldTrigger('quota_hit', ['invite_accepted'])).toBe(false);
  });

  it('rejects a delivery with no event name once a filter is set', () => {
    expect(shouldTrigger(undefined, ['invite_accepted'])).toBe(false);
    expect(shouldTrigger(42, ['invite_accepted'])).toBe(false);
  });
});

describe('webhook', () => {
  const delivery = {
    event: 'invite_accepted',
    payload: { publicId: 'ada-lovelace', acceptedAt: 1_700_000_000_000 },
    at: 1_700_000_000_000,
  };

  it('starts the workflow with the whole delivery by default', async () => {
    const result = await receive(delivery);
    expect(result.workflowData).toEqual([[{ json: delivery }]]);
    expect(result.webhookResponse).toEqual({ ok: true });
  });

  it('outputs only the payload when asked', async () => {
    const result = await receive(delivery, { payloadOnly: true });
    expect(result.workflowData).toEqual([[{ json: delivery.payload }]]);
  });

  it('falls back to the whole delivery when there is no payload object', async () => {
    const result = await receive({ event: 'quota_hit' }, { payloadOnly: true });
    expect(result.workflowData).toEqual([[{ json: { event: 'quota_hit' } }]]);
  });

  it('answers but does not start the workflow for an event that was filtered out', async () => {
    const result = await receive(delivery, { events: ['challenge_detected'] });
    expect(result.workflowData).toBeUndefined();
    expect(result.webhookResponse).toEqual({ ok: true, ignored: 'invite_accepted' });
  });

  it('starts the workflow when the event is in the filter', async () => {
    const result = await receive(delivery, { events: ['invite_accepted', 'positive_reply'] });
    expect(result.workflowData).toEqual([[{ json: delivery }]]);
  });

  it('survives an empty body', async () => {
    const result = await receive(undefined);
    expect(result.workflowData).toEqual([[{ json: {} }]]);
  });
});
