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
import warmConnect from '../../sequences/warm-connect.json';
import connectThenMessage from '../../sequences/connect-then-message.json';

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
  // Reads that every tick makes, answered by URL so the tests only have to
  // queue the writes they care about. Individual tests re-route these.
  net.route('/messaging/conversations', { elements: [] }); // a quiet inbox
  net.route('normInvitations?q=sentInvitationsV2', { elements: [] }); // nothing pending
  net.route('/identity/profiles/', profileView); // 2nd degree
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
    net.push({}); // the invite
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
    net.push({}); // the invite
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    // The invitation is no longer pending; the branch confirms with one read
    // that post-dates the invitation, and finds a first-degree connection.
    net.route('/identity/profiles/', inviteAccepted);
    net.push({}); // the message
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const log = await storage.allActions();
    expect(log.map((e) => e.action)).toContain(ACTIONS.OUTREACH_MESSAGE);
    const e = await enrollmentOf(c.campaignId);
    expect(e.accepted).toBe(true);
  });

  it('takes the else arm when it was not accepted', async () => {
    await makeCampaign(branched);
    net.push({}); // the invite
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    // The invitation is still pending, so the branch takes the else arm.
    net.route('normInvitations?q=sentInvitationsV2', { elements: [{ invitee: { miniProfile: { publicIdentifier: 'adalovelace' } } }] });
    net.push({}); // the follow
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const log = await storage.allActions();
    expect(log.map((e) => e.action)).toContain(ACTIONS.OUTREACH_FOLLOW);
    expect(log.map((e) => e.action)).not.toContain(ACTIONS.OUTREACH_MESSAGE);
  });

  it('climbs back out of the arm and finishes', async () => {
    const c = await makeCampaign(branched);
    net.push({}); // the invite
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    net.push({}); // whichever arm it takes
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
    net.push({}); // the invite
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect((await enrollmentOf(c.campaignId)).path).toEqual([]);

    jump(73 * HOUR);
    net.route('normInvitations?q=sentInvitationsV2', { elements: [{ invitee: { miniProfile: { publicIdentifier: 'adalovelace' } } }] });
    net.push({}); // the follow
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect((await storage.allActions()).map((e) => e.action)).toContain(ACTIONS.OUTREACH_FOLLOW);
  });
});

describe('stopOnReply', () => {
  it('stops the enrollment once they have replied', async () => {
    const c = await makeCampaign([{ type: 'view' }, { type: 'invite', note: 'Hi' }]);
    net.push(profileView);
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    jump(HOUR);
    const reply = inboundNow();
    net.route('/messaging/conversations/', reply.messages);
    net.route('/messaging/conversations?', reply.threads);

    const postsBefore = net.calls.filter((x) => x.method === 'POST').length;
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    expect((await enrollmentOf(c.campaignId)).status).toBe('replied');
    expect(net.calls.filter((x) => x.method === 'POST')).toHaveLength(postsBefore);
  });

  it('the tick detects the reply itself and emits reply_received', async () => {
    await makeCampaign([{ type: 'view' }, { type: 'invite', note: 'Hi' }]);

    // First tick: a quiet inbox, which only seeds the watermarks.
    net.push(profileView);
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(names()).not.toContain('reply_received');

    jump(HOUR);
    const reply = inboundNow('Yes, interested — can we book a call?');
    net.route('/messaging/conversations/', reply.messages);
    net.route('/messaging/conversations?', reply.threads);

    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    expect(names()).toContain('reply_received');
    expect(names()).toContain('positive_reply');
    const thread = (await inbox.storedThreads()).find((t) => t.threadId === '2-abc123');
    expect(thread.sentiment).toBe('positive');
  });

  it('does not stop when stopOnReply is off', async () => {
    const c = await makeCampaign([{ type: 'view' }, { type: 'view' }], { stopOnReply: false });
    net.push(profileView);
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    jump(HOUR);
    const reply = inboundNow();
    net.route('/messaging/conversations/', reply.messages);
    net.route('/messaging/conversations?', reply.threads);

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

    for (let i = 0; i < 3; i += 1) net.push({}); // three invites
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const notes = net.calls.filter((x) => x.json && x.json.message).map((x) => x.json.message);
    expect(notes).toEqual(['A Ada', 'B Bob', 'A Carla']);
    expect((await handle(ACTIONS.CAMPAIGN_GET, { campaignId: c.campaignId })).data.stats.sent).toBe(
      3,
    );
  });
});

describe('variants without a note or body', () => {
  it('uses the variants when the step carries no literal text', async () => {
    await handle(ACTIONS.CAMPAIGN_CREATE, {
      name: 'Variants only',
      steps: [{ type: 'invite', variants: ['Only A {{firstName}}', 'Only B {{firstName}}'] }],
      publicIds: ['adalovelace', 'bobbright'],
    });
    await storage.putProfile({ publicId: 'bobbright', firstName: 'Bob' });

    for (let i = 0; i < 2; i += 1) net.push({}); // two invites
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const notes = net.calls.filter((x) => x.json && x.json.message).map((x) => x.json.message);
    expect(notes).toEqual(['Only A Ada', 'Only B Bob']);
  });

  it('does the same for a message step', async () => {
    await handle(ACTIONS.CAMPAIGN_CREATE, {
      name: 'Message variants',
      steps: [{ type: 'message', variants: ['Body A {{firstName}}'] }],
      publicIds: ['adalovelace'],
    });
    net.push({}); // the message
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const body =
      net.calls[net.calls.length - 1].json.conversationCreate.eventCreate.value[
        'com.linkedin.voyager.messaging.create.MessageCreate'
      ].attributedBody.text;
    expect(body).toBe('Body A Ada');
  });
});

describe('already connected', () => {
  it('skips an invite to someone we are already connected to', async () => {
    const c = await makeCampaign([{ type: 'invite', note: 'Hi' }]);
    net.route('/identity/profiles/', inviteAccepted); // 1st degree

    const res = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(res.data).toEqual({ executed: 0, queued: 0 });
    expect(net.calls.filter((x) => x.method === 'POST')).toHaveLength(0);
    expect((await storage.allActions()).map((e) => e.action)).not.toContain(
      ACTIONS.OUTREACH_INVITE,
    );

    const e = await enrollmentOf(c.campaignId);
    expect(e.accepted).toBe(true);
    expect(e.status).toBe('accepted');
    expect(seen.find((f) => f.event === 'campaign_step_done').payload).toMatchObject({
      status: 'skipped',
      reason: 'alreadyConnected',
    });
  });

  it("a branch on 'accepted' treats an existing connection as accepted", async () => {
    await makeCampaign([
      { type: 'invite', note: 'Hi' },
      {
        type: 'branch',
        branch: {
          on: 'accepted',
          then: [{ type: 'message', body: 'Good to be connected' }],
          else: [{ type: 'follow' }],
        },
      },
    ]);

    net.route('/identity/profiles/', inviteAccepted); // 1st degree already
    net.push({}); // the message

    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const log = (await storage.allActions()).map((e) => e.action);
    expect(log).toContain(ACTIONS.OUTREACH_MESSAGE);
    expect(log).not.toContain(ACTIONS.OUTREACH_INVITE);
    expect(log).not.toContain(ACTIONS.OUTREACH_FOLLOW);
  });

  it('spends exactly one profile view on an invite to a stranger', async () => {
    await makeCampaign([{ type: 'invite', note: 'Hi' }]);
    net.push({}); // the invite

    const res = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    expect(res.data.executed).toBe(1);
    // The pre-check read the profile; the urn resolution reused it.
    expect((await quota.snapshot('visit')).dailyUsed).toBe(1);
    expect(net.calls.filter((x) => x.url.includes('/identity/profiles/'))).toHaveLength(1);
  });

  it('still invites someone we are not connected to', async () => {
    await makeCampaign([{ type: 'invite', note: 'Hi' }]);
    net.push({}); // the invite
    const res = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(res.data.executed).toBe(1);
  });
});

describe('shipped sequence templates', () => {
  it('loads a sequence file straight into campaign.create', async () => {
    const res = await handle(ACTIONS.CAMPAIGN_CREATE, {
      ...warmConnect,
      publicIds: ['adalovelace'],
    });
    expect(res.ok).toBe(true);
    expect(res.data.name).toBe('Warm connect');
    expect(res.data.steps).toEqual(warmConnect.steps);
    expect(res.data.settings).toEqual({ stopOnReply: true, autopilot: false });
    expect(res.data.stats.enrolled).toBe(1);
  });

  it('takes a settings block from the file when there is one', async () => {
    const res = await handle(ACTIONS.CAMPAIGN_CREATE, {
      ...connectThenMessage,
      settings: { stopOnReply: false, autopilot: true },
    });
    expect(res.data.settings).toEqual({ stopOnReply: false, autopilot: true });
  });

  it('runs the branching template through its first steps', async () => {
    await handle(ACTIONS.CAMPAIGN_CREATE, {
      ...connectThenMessage,
      publicIds: ['adalovelace'],
    });

    net.push(profileView); // the view
    expect((await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system')).data.executed).toBe(1);

    // the wait (the template decides how long)
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    jump(connectThenMessage.steps[1].waitMs + HOUR);

    net.push({}); // the invite
    expect((await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system')).data.executed).toBe(1);
    expect(net.calls[net.calls.length - 1].json.message).toMatch(/^Hi Ada/);
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

  it('carries the campaign context through the queue into the action log', async () => {
    await setConfig({ autopilot: false });
    const c = await makeCampaign([{ type: 'invite', note: 'Hi {{firstName}}' }]);

    const tickRes = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(tickRes.data.queued).toBe(1);

    const item = (await queue.list('pending'))[0];
    expect(item.context).toEqual({ campaignId: c.campaignId, stepIndex: 0 });
    // The engine's own fields never reach LinkedIn.
    expect(item.params.campaignId).toBeUndefined();
    expect(item.params.stepIndex).toBeUndefined();
    expect(item.params.note).toBe('Hi Ada');

    net.push({}); // the invite
    await handle(ACTIONS.QUEUE_APPROVE, { ids: [item.id] });

    const entry = (await storage.allActions()).find((e) => e.action === ACTIONS.OUTREACH_INVITE);
    expect(entry.campaignId).toBe(c.campaignId);
    expect(entry.stepIndex).toBe(0);

    const stats = (await handle(ACTIONS.CAMPAIGN_GET, { campaignId: c.campaignId })).data.stats;
    expect(stats.sent).toBe(1);
    expect(stats.byStep[0]).toEqual({ sent: 1 });
  });

  it('does not advance past a queued step until it has been sent', async () => {
    await setConfig({ autopilot: false });
    const c = await makeCampaign([
      { type: 'invite', note: 'Hi' },
      { type: 'message', body: 'Following up' },
    ]);

    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    const item = (await queue.list('pending'))[0];
    let e = await enrollmentOf(c.campaignId);
    expect(e.stepIndex).toBe(0);
    expect(e.pendingQueueId).toBe(item.id);

    // While it waits, the tick does nothing at all for this person.
    expect((await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system')).data).toEqual({
      executed: 0,
      queued: 0,
    });
    expect(await queue.list('pending')).toHaveLength(1);

    net.push({}); // the approved invite
    await handle(ACTIONS.QUEUE_APPROVE, { ids: [item.id] });

    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    e = await enrollmentOf(c.campaignId);
    expect(e.stepIndex).toBe(1);
    expect(e.pendingQueueId).not.toBe(item.id); // the message is queued instead
    expect(await queue.list('pending')).toHaveLength(1);
  });

  it('stops the enrollment when a queued step is rejected', async () => {
    await setConfig({ autopilot: false });
    const c = await makeCampaign([{ type: 'invite', note: 'Hi' }, { type: 'view' }]);

    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    const item = (await queue.list('pending'))[0];
    await handle(ACTIONS.QUEUE_REJECT, { ids: [item.id] });

    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    const e = await enrollmentOf(c.campaignId);
    expect(e.status).toBe('stopped');
    expect(e.error).toMatch(/rejected/i);
  });

  it('keeps rotating variants across ticks, not just within one', async () => {
    const c = (
      await handle(ACTIONS.CAMPAIGN_CREATE, {
        name: 'Across ticks',
        steps: [{ type: 'invite', variants: ['A {{firstName}}', 'B {{firstName}}'] }],
        publicIds: ['adalovelace'],
      })
    ).data;
    await handle(ACTIONS.CAMPAIGN_ENROLL, { campaignId: c.campaignId, publicIds: ['bobbright'] });
    await storage.putProfile({ publicId: 'bobbright', firstName: 'Bob' });

    // One person a tick, by leaving only one invite's worth of quota per day.
    await setConfig({ accountPreset: 'free', dailyInviteCap: 1, hourlyCap: 50 });

    net.push({});
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    jump(24 * HOUR);
    net.push({});
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const notes = net.calls.filter((x) => x.json && x.json.message).map((x) => x.json.message);
    expect(notes).toEqual(['A Ada', 'B Bob']);
  });

  it('halts the tick outside business hours', async () => {
    await setConfig({ businessHoursOnly: true, businessStart: 9, businessEnd: 18 });
    const c = await makeCampaign([{ type: 'invite', note: 'Hi' }]);
    vi.setSystemTime(new Date(2026, 8, 9, 22, 0, 0));
    const res = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(res.data).toEqual({ executed: 0, queued: 0 });
    expect((await enrollmentOf(c.campaignId)).status).toBe('active');
    // It reads the inbox and then stops: no profile reads, no writes.
    expect(net.calls.every((x) => x.url.includes('/messaging/conversations'))).toBe(true);
    expect(net.calls.filter((x) => x.method === 'POST')).toHaveLength(0);
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
