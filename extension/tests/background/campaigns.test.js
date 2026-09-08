import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as campaigns from '../../src/background/campaigns.js';
import * as events from '../../src/background/events.js';
import * as inbox from '../../src/background/inbox.js';
import * as queue from '../../src/background/queue.js';
import * as quota from '../../src/background/quota.js';
import * as storage from '../../src/lib/storage.js';
import '../../src/background/outreach.js';
import '../../src/background/lists.js';
import { seedSession, stubFetch } from '../helpers/net.js';

import profileView from '../fixtures/voyager/profileView.json';
import inviteAccepted from '../fixtures/voyager/inviteAccepted.json';
import conversations from '../fixtures/voyager/conversations.json';
import conversationEvents from '../fixtures/voyager/conversationEvents.json';

const START = new Date(2026, 8, 9, 11, 0, 0);
const HOUR = 3600000;

let net;
let seen;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  quota.setSleepFn(() => Promise.resolve());
  seedSession();
  net = stubFetch();
  seen = [];
  events.setSink((f) => seen.push(f));
  await setConfig({
    autopilot: true,
    accountPreset: 'recruiter',
    hourlyCap: 50,
    // Business hours are exercised in quota.test.js; jumping days here would
    // otherwise land the tick on a weekend.
    businessHoursOnly: false,
  });
  await storage.putProfile({
    publicId: 'adalovelace',
    firstName: 'Ada',
    fullName: 'Ada Lovelace',
    company: 'Analytical Engines',
  });
});

afterEach(() => {
  events.setSink(null);
  vi.useRealTimers();
});

const names = () => seen.map((f) => f.event);
const jump = (ms) => vi.setSystemTime(new Date(Date.now() + ms));

/** The conversation fixtures carry fixed timestamps; restamp them to "now". */
function inboundNow(text = 'Yes, happy to talk.') {
  const at = Date.now();
  const threads = structuredClone(conversations);
  threads.elements[0].lastActivityAt = at;
  threads.elements[0].events[0].createdAt = at;
  threads.elements[0].events[0].eventContent[
    'com.linkedin.voyager.messaging.event.MessageEvent'
  ].attributedBody.text = text;

  const messages = structuredClone(conversationEvents);
  messages.elements[0].createdAt = at;
  messages.elements[0].eventContent[
    'com.linkedin.voyager.messaging.event.MessageEvent'
  ].attributedBody.text = text;

  return { threads, messages };
}

async function makeCampaign(steps, settings = {}) {
  const res = await handle(ACTIONS.CAMPAIGN_CREATE, {
    name: 'Test',
    steps,
    publicIds: ['adalovelace'],
    settings,
  });
  return res.data;
}

async function enrollmentOf(campaignId) {
  return (await campaigns.readEnrollments(campaignId))[0];
}

describe('create and enroll', () => {
  it('creates with the contract shape and enrolls the given publicIds', async () => {
    const c = await makeCampaign([{ type: 'view' }]);
    expect(c.campaignId).toMatch(/^camp_/);
    expect(c.status).toBe('active');
    expect(c.settings).toEqual({ stopOnReply: true, autopilot: false });
    expect(c.stats.enrolled).toBe(1);

    const e = await enrollmentOf(c.campaignId);
    expect(e).toMatchObject({ publicId: 'adalovelace', stepIndex: 0, path: [], status: 'active' });
  });

  it('enrolls everyone on a list', async () => {
    const list = (await handle(ACTIONS.LIST_CREATE, { name: 'L' })).data;
    await handle(ACTIONS.LIST_ADD, {
      listId: list.listId,
      profiles: [{ publicId: 'adalovelace' }, { publicId: 'bobbright' }],
    });
    const c = (
      await handle(ACTIONS.CAMPAIGN_CREATE, { name: 'FromList', steps: [], listId: list.listId })
    ).data;
    expect(c.stats.enrolled).toBe(2);
  });

  it('skips people already enrolled', async () => {
    const c = await makeCampaign([{ type: 'view' }]);
    const res = await handle(ACTIONS.CAMPAIGN_ENROLL, {
      campaignId: c.campaignId,
      publicIds: ['adalovelace', 'bobbright'],
    });
    expect(res.data).toEqual({ enrolled: 1, skipped: 1 });
  });

  it('pauses, resumes and deletes', async () => {
    const c = await makeCampaign([{ type: 'view' }]);
    expect((await handle(ACTIONS.CAMPAIGN_PAUSE, { campaignId: c.campaignId })).data.status).toBe(
      'paused',
    );
    expect((await handle(ACTIONS.CAMPAIGN_RESUME, { campaignId: c.campaignId })).data.status).toBe(
      'active',
    );
    await handle(ACTIONS.CAMPAIGN_DELETE, { campaignId: c.campaignId });
    expect((await handle(ACTIONS.CAMPAIGN_GET_ALL, {})).data.campaigns).toHaveLength(0);
    expect(await storage.get(storage.K.enrollments(c.campaignId), null)).toBe(null);
  });
});

describe('linear sequence', () => {
  it('runs one write per tick and waits between them', async () => {
    const c = await makeCampaign([
      { type: 'view' },
      { type: 'wait', waitMs: 24 * HOUR },
      { type: 'invite', note: 'Hi {{firstName}}' },
    ]);

    net.push(profileView); // the view
    let res = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(res.data.executed).toBe(1);
    expect(names()).toContain('campaign_step_done');

    // The wait resolves in the same tick as the step it follows? No: the next
    // tick schedules it and stops.
    res = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(res.data.executed).toBe(0);
    const waiting = await enrollmentOf(c.campaignId);
    expect(waiting.nextAt).toBe(Date.now() + 24 * HOUR);
    expect(waiting.stepIndex).toBe(2);

    // Not due yet.
    jump(HOUR);
    expect((await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system')).data.executed).toBe(0);
    expect(net.calls.filter((x) => x.method === 'POST')).toHaveLength(0);

    jump(24 * HOUR);
    net.push(profileView); // urn resolution for the invite
    net.push({});
    res = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(res.data.executed).toBe(1);

    const invite = net.calls[net.calls.length - 1];
    expect(invite.json.message).toBe('Hi Ada');

    const done = await enrollmentOf(c.campaignId);
    expect(done.status).toBe('done');
    expect(names()).toContain('campaign_completed');
  });

  it('marks the campaign completed when nobody is active', async () => {
    const c = await makeCampaign([{ type: 'view' }]);
    net.push(profileView);
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect((await handle(ACTIONS.CAMPAIGN_GET, { campaignId: c.campaignId })).data.status).toBe(
      'completed',
    );
  });

  it('respects nextAt', async () => {
    const c = await makeCampaign([{ type: 'wait', waitMs: 2 * HOUR }, { type: 'view' }]);
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect((await enrollmentOf(c.campaignId)).nextAt).toBe(START.getTime() + 2 * HOUR);

    expect((await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system')).data.executed).toBe(0);
    jump(3 * HOUR);
    net.push(profileView);
    expect((await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system')).data.executed).toBe(1);
  });
});

describe('branching', () => {
  const branched = [
    { type: 'invite', note: 'Hi' },
    {
      type: 'branch',
      branch: {
        on: 'accepted',
        then: [{ type: 'message', body: 'Thanks for connecting' }],
        else: [{ type: 'follow' }],
      },
    },
  ];

  it('takes the then arm when the invite was accepted', async () => {
    const c = await makeCampaign(branched);
    net.push(profileView);
    net.push({}); // invite
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    net.push(inviteAccepted); // network.status → connected
    net.push(profileView); // urn for the message
    net.push({}); // message
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const log = await storage.allActions();
    expect(log.map((e) => e.action)).toContain(ACTIONS.OUTREACH_MESSAGE);
    const e = await enrollmentOf(c.campaignId);
    expect(e.accepted).toBe(true);
  });

  it('takes the else arm when it was not accepted', async () => {
    await makeCampaign(branched);
    net.push(profileView);
    net.push({});
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    net.push(profileView); // still 2nd degree
    net.push(profileView); // urn for the follow
    net.push({}); // follow
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const log = await storage.allActions();
    expect(log.map((e) => e.action)).toContain(ACTIONS.OUTREACH_FOLLOW);
    expect(log.map((e) => e.action)).not.toContain(ACTIONS.OUTREACH_MESSAGE);
  });

  it('climbs back out of the arm and finishes', async () => {
    const c = await makeCampaign(branched);
    net.push(profileView);
    net.push({});
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    net.push(profileView);
    net.push(profileView);
    net.push({});
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const e = await enrollmentOf(c.campaignId);
    expect(['done', 'accepted']).toContain(e.status);
    expect(e.path).toEqual([]);
  });

  it('notAcceptedAfterMs waits until the window has passed', async () => {
    const c = await makeCampaign([
      { type: 'invite', note: 'Hi' },
      {
        type: 'branch',
        branch: {
          on: 'notAcceptedAfterMs',
          ms: 72 * HOUR,
          then: [{ type: 'follow' }],
          else: [],
        },
      },
    ]);
    net.push(profileView);
    net.push({});
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect((await enrollmentOf(c.campaignId)).path).toEqual([]);

    jump(73 * HOUR);
    net.push(profileView); // still not connected
    net.push(profileView); // urn for the follow
    net.push({});
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect((await storage.allActions()).map((e) => e.action)).toContain(ACTIONS.OUTREACH_FOLLOW);
  });
});

describe('stopOnReply', () => {
  it('stops the enrollment once they have replied', async () => {
    const c = await makeCampaign([{ type: 'view' }, { type: 'invite', note: 'Hi' }]);
    net.push(profileView);
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    net.push(conversations);
    await inbox.detectReplies();

    jump(HOUR);
    const reply = inboundNow();
    net.push(reply.threads);
    net.push(reply.messages);
    await inbox.detectReplies();

    const before = net.calls.length;
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect((await enrollmentOf(c.campaignId)).status).toBe('replied');
    expect(net.calls).toHaveLength(before);
  });

  it('does not stop when stopOnReply is off', async () => {
    const c = await makeCampaign([{ type: 'view' }, { type: 'view' }], { stopOnReply: false });
    net.push(profileView);
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    net.push(conversations);
    await inbox.detectReplies();
    jump(HOUR);
    const reply = inboundNow();
    net.push(reply.threads);
    net.push(reply.messages);
    await inbox.detectReplies();

    net.push(profileView);
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect((await enrollmentOf(c.campaignId)).status).not.toBe('replied');
  });
});

describe('variants', () => {
  it('rotates round-robin across the campaign', async () => {
    const c = (
      await handle(ACTIONS.CAMPAIGN_CREATE, {
        name: 'Variants',
        steps: [{ type: 'invite', variants: ['A {{firstName}}', 'B {{firstName}}'] }],
        publicIds: ['adalovelace', 'bobbright', 'carlachen'],
      })
    ).data;
    await storage.putProfile({ publicId: 'bobbright', firstName: 'Bob' });
    await storage.putProfile({ publicId: 'carlachen', firstName: 'Carla' });

    for (let i = 0; i < 3; i += 1) {
      net.push(profileView);
      net.push({});
    }
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const notes = net.calls.filter((x) => x.json && x.json.message).map((x) => x.json.message);
    expect(notes).toEqual(['A Ada', 'B Bob', 'A Carla']);
    expect((await handle(ACTIONS.CAMPAIGN_GET, { campaignId: c.campaignId })).data.stats.sent).toBe(
      3,
    );
  });
});

describe('copilot and quotas', () => {
  it('queues campaign writes while autopilot is off', async () => {
    await setConfig({ autopilot: false });
    await makeCampaign([{ type: 'invite', note: 'Hi' }]);
    const res = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(res.data.queued).toBe(1);
    expect(res.data.executed).toBe(0);
    expect(await queue.pendingCount()).toBe(1);
  });

  it('halts the tick when the quota is spent', async () => {
    await setConfig({ accountPreset: 'free' });
    await quota.record('invite', 20);
    const c = await makeCampaign([{ type: 'invite', note: 'Hi' }]);
    const res = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(res.data).toEqual({ executed: 0, queued: 0 });
    expect((await enrollmentOf(c.campaignId)).status).toBe('active');
  });

  it('halts the tick outside business hours', async () => {
    await setConfig({ businessHoursOnly: true, businessStart: 9, businessEnd: 18 });
    const c = await makeCampaign([{ type: 'invite', note: 'Hi' }]);
    vi.setSystemTime(new Date(2026, 8, 9, 22, 0, 0));
    const res = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(res.data).toEqual({ executed: 0, queued: 0 });
    expect((await enrollmentOf(c.campaignId)).status).toBe('active');
    expect(net.calls).toHaveLength(0);
  });

  it('runs the registered tick hooks', async () => {
    const calls = [];
    campaigns.addTickHook((info) => calls.push(info));
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(calls).toHaveLength(1);
  });
});

describe('v1 migration', () => {
  it('converts a v1 record and its contacts on first read', async () => {
    await storage.set(storage.K.CAMPAIGNS, [
      {
        id: 'camp_old',
        campaignId: 'camp_old',
        name: 'Legacy',
        status: 'active',
        createdAt: 1700000000000,
        steps: [
          { type: 'view_profile' },
          { type: 'wait', delay_hours: 48 },
          { type: 'send_invite', message_template: 'Hi {{firstName}}' },
          { type: 'send_message', delay_hours: 24, message_template: 'Following up' },
        ],
        contacts: [{ publicIdentifier: 'adalovelace', currentStep: 1, replied: false }],
      },
    ]);

    const list = await campaigns.readCampaigns();
    expect(list[0].steps).toEqual([
      { type: 'view' },
      { type: 'wait', waitMs: 48 * HOUR },
      { type: 'invite', note: 'Hi {{firstName}}' },
      { type: 'wait', waitMs: 24 * HOUR },
      { type: 'message', body: 'Following up' },
    ]);
    expect(list[0].settings).toEqual({ stopOnReply: true, autopilot: false });
    expect(list[0].contacts).toBeUndefined();
    expect(list[0].migratedFrom).toBe('v1');

    const enrollments = await campaigns.readEnrollments('camp_old');
    expect(enrollments[0]).toMatchObject({ publicId: 'adalovelace', stepIndex: 1, status: 'active' });

    // Idempotent: a second read does not migrate again.
    const again = await campaigns.readCampaigns();
    expect(again[0].steps).toHaveLength(5);
  });
});
