import { describe, expect, it } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';

import { ACTIONS } from '../nodes/LinkedInToolkit/actions.generated';
import { LinkedInToolkit, buildParams, coerce } from '../nodes/LinkedInToolkit/LinkedInToolkit.node';
import { makeContext } from './helpers';

const node = new LinkedInToolkit();

async function run(context: ReturnType<typeof makeContext>) {
  return node.execute.call(context as unknown as IExecuteFunctions);
}

describe('parameter to request mapping', () => {
  it('posts required and optional fields under their contract names', async () => {
    const context = makeContext({
      parameters: {
        resource: 'search',
        operation: 'search.people',
        search_people_keywords: 'CTO fintech',
        search_people_extra: {
          search_people_title: 'Chief Technology Officer',
          search_people_count: 25,
          search_people_source: 'salesnav',
        },
      },
      response: { id: 'req_1', ok: true, data: { profiles: [{ publicId: 'a' }] } },
    });

    const output = await run(context);

    expect(context.requests).toHaveLength(1);
    expect(context.requests[0]).toMatchObject({
      method: 'POST',
      url: 'http://127.0.0.1:47830/actions/search.people',
      credentialType: 'linkedInToolkitApi',
    });
    expect(context.requests[0].body).toEqual({
      keywords: 'CTO fintech',
      title: 'Chief Technology Officer',
      count: 25,
      source: 'salesnav',
    });
    expect(output[0][0].json).toEqual({ profiles: [{ publicId: 'a' }] });
  });

  it('drops an optional string the user left empty rather than sending ""', async () => {
    const context = makeContext({
      parameters: {
        operation: 'search.people',
        search_people_keywords: 'CTO',
        search_people_extra: { search_people_title: '', search_people_location: 'London' },
      },
    });
    await run(context);
    expect(context.requests[0].body).toEqual({ keywords: 'CTO', location: 'London' });
  });

  it('splits a comma-separated list into an array', async () => {
    const context = makeContext({
      parameters: {
        operation: 'network.status',
        'network_status_publicIds': 'ada-lovelace, grace-hopper ,  ',
      },
    });
    await run(context);
    expect(context.requests[0].body).toEqual({ publicIds: ['ada-lovelace', 'grace-hopper'] });
  });

  it('parses a JSON field', async () => {
    const context = makeContext({
      parameters: {
        operation: 'campaign.create',
        campaign_create_name: 'Q3 outbound',
        campaign_create_steps: '[{"type":"invite","note":"Hello."},{"type":"wait","waitMs":86400000}]',
      },
    });
    await run(context);
    expect(context.requests[0].body).toEqual({
      name: 'Q3 outbound',
      steps: [
        { type: 'invite', note: 'Hello.' },
        { type: 'wait', waitMs: 86400000 },
      ],
    });
  });

  it('sends dry_run when the user asks for a preview', async () => {
    const context = makeContext({
      parameters: {
        operation: 'outreach.invite',
        outreach_invite_publicId: 'ada-lovelace',
        outreach_invite_extra: {
          outreach_invite_note: 'Enjoyed your talk.',
          outreach_invite_dry_run: true,
        },
      },
      response: { id: 'req_1', ok: true, data: { status: 'dryRun' } },
    });
    await run(context);
    expect(context.requests[0].body).toEqual({
      publicId: 'ada-lovelace',
      note: 'Enjoyed your talk.',
      dry_run: true,
    });
  });

  it('posts an empty body for an action that takes no params', async () => {
    const context = makeContext({ parameters: { operation: 'status.get' } });
    await run(context);
    expect(context.requests[0].url).toBe('http://127.0.0.1:47830/actions/status.get');
    expect(context.requests[0].body).toEqual({});
  });

  it('honours a base URL with a trailing slash', async () => {
    const context = makeContext({
      parameters: { operation: 'status.get' },
      credentials: { baseUrl: 'http://host.docker.internal:47830/', token: 't' },
    });
    await run(context);
    expect(context.requests[0].url).toBe('http://host.docker.internal:47830/actions/status.get');
  });

  it('runs once per input item', async () => {
    const context = makeContext({
      parameters: { operation: 'status.get' },
      items: 3,
    });
    const output = await run(context);
    expect(context.requests).toHaveLength(3);
    expect(output[0]).toHaveLength(3);
    expect(output[0][2].pairedItem).toEqual({ item: 2 });
  });
});

describe('output shaping', () => {
  it('returns the envelope data by default', async () => {
    const context = makeContext({
      parameters: { operation: 'status.get' },
      response: { id: 'req_1', ok: true, data: { connected: true } },
    });
    const output = await run(context);
    expect(output[0][0].json).toEqual({ connected: true });
  });

  it('returns the whole envelope when asked', async () => {
    const context = makeContext({
      parameters: { operation: 'status.get', fullEnvelope: true },
      response: { id: 'req_1', ok: true, data: { connected: true } },
    });
    const output = await run(context);
    expect(output[0][0].json).toEqual({ id: 'req_1', ok: true, data: { connected: true } });
  });

  it('wraps a non-object result so the item is still valid JSON', async () => {
    const context = makeContext({
      parameters: { operation: 'network.unfollowCount' },
      response: { id: 'req_1', ok: true, data: 12 },
    });
    const output = await run(context);
    expect(output[0][0].json).toEqual({ data: 12 });
  });
});

describe('failures', () => {
  it('throws with the code and howToFix when the engine refuses', async () => {
    const context = makeContext({
      parameters: { operation: 'outreach.invite', outreach_invite_publicId: 'a' },
      response: {
        id: 'req_1',
        ok: false,
        error: {
          code: 'CHALLENGE_DETECTED',
          message: 'A security challenge is outstanding.',
          howToFix: 'Clear it in Chrome.',
        },
      },
    });
    await expect(run(context)).rejects.toThrow(/CHALLENGE_DETECTED/);
  });

  it('passes the failure through as data when continueOnFail is on', async () => {
    const context = makeContext({
      parameters: { operation: 'outreach.invite', outreach_invite_publicId: 'a' },
      continueOnFail: true,
      response: {
        id: 'req_1',
        ok: false,
        error: { code: 'QUOTA_EXCEEDED', message: '100 invites used today.' },
      },
    });
    const output = await run(context);
    expect(output[0][0].json).toMatchObject({
      error: 'QUOTA_EXCEEDED',
      message: '100 invites used today.',
    });
  });

  it('rejects invalid JSON before making a request', async () => {
    const context = makeContext({
      parameters: {
        operation: 'campaign.create',
        campaign_create_name: 'x',
        campaign_create_steps: '[{oops',
      },
    });
    await expect(run(context)).rejects.toThrow(/not valid JSON/);
    expect(context.requests).toHaveLength(0);
  });

  it('rejects an operation this node does not know', async () => {
    const context = makeContext({ parameters: { operation: 'linkedin.teleport' } });
    await expect(run(context)).rejects.toThrow(/Unknown operation/);
    expect(context.requests).toHaveLength(0);
  });

  it('reports an unrecognised body rather than pretending it succeeded', async () => {
    const context = makeContext({
      parameters: { operation: 'status.get' },
      response: { something: 'else' },
    });
    await expect(run(context)).rejects.toThrow(/INTERNAL/);
  });
});

describe('every action', () => {
  it('maps to its own path with only contract-named params', async () => {
    for (const action of ACTIONS) {
      const parameters: Record<string, unknown> = { operation: action.action };
      for (const field of action.required) {
        parameters[field.name] =
          field.type === 'number' ? 1 : field.type === 'boolean' ? true : field.type === 'json' ? '{"a":1}' : 'x';
      }
      const context = makeContext({ parameters });
      await run(context);

      expect(context.requests[0].url, action.action).toBe(
        `http://127.0.0.1:47830/actions/${action.action}`,
      );
      const sent = Object.keys(context.requests[0].body);
      const allowed = new Set([...action.required, ...action.optional].map((f) => f.key));
      for (const key of sent) expect(allowed.has(key), `${action.action}.${key}`).toBe(true);
    }
  });
});

describe('coerce and buildParams in isolation', () => {
  const field = (overrides: Record<string, unknown>) =>
    ({
      name: 'x_y',
      key: 'y',
      displayName: 'Y',
      type: 'string',
      required: false,
      default: '',
      description: '',
      ...overrides,
    }) as never;

  it('leaves a populated string alone', () => {
    expect(coerce(field({}), 'hello', { nodeName: 'n' })).toBe('hello');
  });

  it('drops an empty JSON default rather than sending {}', () => {
    expect(coerce(field({ type: 'json', default: '{}' }), '{}', { nodeName: 'n' })).toBeUndefined();
    expect(coerce(field({ type: 'json', default: '[]' }), '  ', { nodeName: 'n' })).toBeUndefined();
  });

  it('keeps a false boolean, which is a real value', () => {
    expect(coerce(field({ type: 'boolean' }), false, { nodeName: 'n' })).toBe(false);
  });

  it('keeps zero, which is also a real value', () => {
    expect(coerce(field({ type: 'number' }), 0, { nodeName: 'n' })).toBe(0);
  });

  it('reads optional fields out of the collection, not the top level', () => {
    const action = ACTIONS.find((a) => a.action === 'search.people')!;
    const params = buildParams(action, (name) =>
      name === 'search_people_keywords'
        ? 'CTO'
        : name === 'search_people_extra'
          ? { search_people_count: 10 }
          : undefined,
    );
    expect(params).toEqual({ keywords: 'CTO', count: 10 });
  });
});
