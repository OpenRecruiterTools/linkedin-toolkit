/**
 * LinkedIn Toolkit — sequence engine v2.
 *
 * A campaign is a tree of steps; an enrollment is one person's position in
 * that tree (`path` names the branch arms taken, `stepIndex` the position
 * inside the current arm). `tick()` moves every due enrollment forward by one
 * step, and every write it makes goes through the engine with origin
 * `campaign`, so Copilot mode and the quotas apply exactly as they do
 * everywhere else.
 */

import { ACTIONS, ERROR, EVENTS, EngineError } from '../lib/actions.js';
import { handle, register } from './engine.js';
import { K, allActions, get, getStoredProfile, newId, remove, set, stamp } from '../lib/storage.js';
import { pickVariant, renderTemplate } from '../lib/template.js';
import { emit } from './events.js';
import * as inbox from './inbox.js';
import * as lists from './lists.js';

// network.status must be registered for the 'accepted' branch to resolve.
import './extract.js';

/** Step type → the contract action that performs it. */
const STEP_ACTION = {
  view: ACTIONS.OUTREACH_VIEW,
  follow: ACTIONS.OUTREACH_FOLLOW,
  invite: ACTIONS.OUTREACH_INVITE,
  message: ACTIONS.OUTREACH_MESSAGE,
  inmail: ACTIONS.OUTREACH_INMAIL,
  like: ACTIONS.OUTREACH_LIKE,
  comment: ACTIONS.OUTREACH_COMMENT,
};

/** Errors that mean nothing else will work this tick either. */
const STOP_THE_TICK = new Set([
  ERROR.QUOTA_EXCEEDED,
  ERROR.OUTSIDE_BUSINESS_HOURS,
  ERROR.RATE_LIMITED,
  ERROR.CHALLENGE_DETECTED,
  ERROR.NOT_LOGGED_IN,
]);

/** Hooks run at the end of every tick (the Research Pack registers one). */
const tickHooks = [];

export function addTickHook(fn) {
  if (typeof fn === 'function') tickHooks.push(fn);
}

/* ================================================================== */
/*  Storage + v1 migration                                            */
/* ================================================================== */

const V1_STEP_TYPES = { view_profile: 'view', send_invite: 'invite', send_message: 'message' };

/** v1 step list → contract Steps, turning `delay_hours` into real wait steps. */
export function migrateSteps(steps = []) {
  const out = [];
  for (const step of steps) {
    if (step.type === 'wait') {
      out.push({ type: 'wait', waitMs: (step.delay_hours || 24) * 3600000 });
      continue;
    }
    const type = V1_STEP_TYPES[step.type] || step.type;
    if (step.delay_hours) out.push({ type: 'wait', waitMs: step.delay_hours * 3600000 });
    const next = { type };
    if (type === 'invite' && step.message_template) next.note = step.message_template;
    if ((type === 'message' || type === 'inmail') && step.message_template) {
      next.body = step.message_template;
    }
    out.push(next);
  }
  return out;
}

/** A v1 campaign record → the contract Campaign plus its enrollments. */
export function migrateCampaign(v1) {
  const campaign = stamp({
    campaignId: v1.campaignId || v1.id || newId('camp'),
    name: v1.name || 'Untitled campaign',
    steps: migrateSteps(v1.steps),
    status: v1.status === 'completed' ? 'completed' : v1.status || 'active',
    createdAt: v1.createdAt || Date.now(),
    settings: { stopOnReply: true, autopilot: false, ...(v1.settings || {}) },
    variantCursor: 0,
    migratedFrom: 'v1',
  });

  const enrollments = (v1.contacts || []).map((c) =>
    stamp({
      publicId: c.publicIdentifier || c.publicId || '',
      stepIndex: c.currentStep || 0,
      path: [],
      nextAt: 0,
      status: c.replied ? 'replied' : 'active',
      lastActionAt: c.lastStepAt ? new Date(c.lastStepAt).getTime() : 0,
      enrolledAt: v1.createdAt || Date.now(),
    }),
  );

  return { campaign, enrollments };
}

function isV1(record) {
  return Array.isArray(record.contacts) || !record.settings;
}

/** Read the campaign list, migrating any v1 records the first time. */
export async function readCampaigns() {
  const raw = await get(K.CAMPAIGNS, []);
  if (!raw.some(isV1)) return raw;

  const migrated = [];
  for (const record of raw) {
    if (!isV1(record)) {
      migrated.push(record);
      continue;
    }
    const { campaign, enrollments } = migrateCampaign(record);
    await set(K.enrollments(campaign.campaignId), enrollments);
    migrated.push(campaign);
  }
  await set(K.CAMPAIGNS, migrated);
  return migrated;
}

async function writeCampaigns(campaigns) {
  await set(K.CAMPAIGNS, campaigns);
  return campaigns;
}

export async function readEnrollments(campaignId) {
  return get(K.enrollments(campaignId), []);
}

async function writeEnrollments(campaignId, enrollments) {
  await set(K.enrollments(campaignId), enrollments);
  return enrollments;
}

async function requireCampaign(campaignId) {
  const campaign = (await readCampaigns()).find((c) => c.campaignId === campaignId);
  if (!campaign) throw new EngineError(ERROR.NOT_FOUND, `Campaign ${campaignId} not found.`);
  return campaign;
}

/* ================================================================== */
/*  Step tree navigation                                              */
/* ================================================================== */

/**
 * The step array an enrollment is currently inside.
 * `path` is pairs of [branchStepIndex, 0 for `then` | 1 for `else`].
 */
export function stepsAt(campaign, path = []) {
  let steps = campaign.steps || [];
  for (let i = 0; i + 1 < path.length; i += 2) {
    const branch = (steps[path[i]] || {}).branch;
    if (!branch) return [];
    steps = (path[i + 1] === 0 ? branch.then : branch.else) || [];
  }
  return steps;
}

/** Move one step on, climbing out of any branch arms that just finished. */
function advance(campaign, enrollment) {
  enrollment.stepIndex += 1;
  while (enrollment.path.length >= 2 && enrollment.stepIndex >= stepsAt(campaign, enrollment.path).length) {
    const branchIndex = enrollment.path[enrollment.path.length - 2];
    enrollment.path = enrollment.path.slice(0, -2);
    enrollment.stepIndex = branchIndex + 1;
  }
}

function isFinished(campaign, enrollment) {
  return enrollment.path.length === 0 && enrollment.stepIndex >= (campaign.steps || []).length;
}

/** Mark an enrollment finished. `accepted` is kept as the richer outcome. */
async function finish(campaign, enrollment) {
  enrollment.status = enrollment.accepted ? 'accepted' : 'done';
  enrollment.updatedAt = Date.now();
  await emit(EVENTS.CAMPAIGN_COMPLETED, {
    campaignId: campaign.campaignId,
    publicId: enrollment.publicId,
  });
}

/* ================================================================== */
/*  Campaign CRUD                                                     */
/* ================================================================== */

export async function create({ name, steps, listId, publicIds, settings }) {
  const campaigns = await readCampaigns();
  const campaign = stamp({
    campaignId: newId('camp'),
    name,
    steps: steps || [],
    status: 'active',
    createdAt: Date.now(),
    settings: { stopOnReply: true, autopilot: false, ...(settings || {}) },
    variantCursor: 0,
  });
  campaigns.push(campaign);
  await writeCampaigns(campaigns);

  const ids = [...(publicIds || [])];
  if (listId) {
    for (const member of await lists.allMembers(listId)) ids.push(member.publicId);
  }
  if (ids.length) await enroll(campaign.campaignId, ids);

  return withStats(campaign);
}

export async function getAll() {
  const campaigns = await readCampaigns();
  const out = [];
  for (const campaign of campaigns) out.push(await withStats(campaign));
  return out;
}

export async function getOne(campaignId) {
  return withStats(await requireCampaign(campaignId));
}

export async function enroll(campaignId, publicIds) {
  await requireCampaign(campaignId);
  const enrollments = await readEnrollments(campaignId);
  const seen = new Set(enrollments.map((e) => e.publicId));

  let enrolled = 0;
  let skipped = 0;
  for (const publicId of publicIds) {
    if (!publicId || seen.has(publicId)) {
      skipped += 1;
      continue;
    }
    seen.add(publicId);
    enrollments.push(
      stamp({
        publicId,
        stepIndex: 0,
        path: [],
        nextAt: 0,
        status: 'active',
        lastActionAt: 0,
        enrolledAt: Date.now(),
      }),
    );
    enrolled += 1;
  }

  await writeEnrollments(campaignId, enrollments);
  return { enrolled, skipped };
}

export async function setStatus(campaignId, status) {
  const campaigns = await readCampaigns();
  const campaign = campaigns.find((c) => c.campaignId === campaignId);
  if (!campaign) throw new EngineError(ERROR.NOT_FOUND, `Campaign ${campaignId} not found.`);
  campaign.status = status;
  campaign.updatedAt = Date.now();
  await writeCampaigns(campaigns);
  return withStats(campaign);
}

export async function del(campaignId) {
  const campaign = await requireCampaign(campaignId);
  const campaigns = await readCampaigns();
  await writeCampaigns(campaigns.filter((c) => c.campaignId !== campaignId));
  await remove(K.enrollments(campaignId));
  return withStats(campaign);
}

/* ================================================================== */
/*  Stats                                                             */
/* ================================================================== */

/** Stats are derived from the action log and the enrollments, never stored. */
export async function statsFor(campaignId) {
  const enrollments = await readEnrollments(campaignId);
  const log = (await allActions()).filter((e) => e.campaignId === campaignId);
  const threads = await inbox.storedThreads();

  const enrolledIds = new Set(enrollments.map((e) => e.publicId));
  const byStep = {};
  let sent = 0;

  for (const entry of log) {
    if (!entry.result || entry.result.status !== 'sent') continue;
    sent += 1;
    const index = entry.stepIndex === undefined ? 0 : entry.stepIndex;
    byStep[index] = byStep[index] || { sent: 0 };
    byStep[index].sent += 1;
  }

  const accepted = (await allActions()).filter(
    (e) => e.action === EVENTS.INVITE_ACCEPTED && enrolledIds.has(e.publicId),
  ).length;

  const replied = enrollments.filter((e) => e.status === 'replied').length;
  const positive = threads.filter(
    (t) =>
      t.sentiment === 'positive' && t.participants.some((p) => enrolledIds.has(p.publicId)),
  ).length;

  return { enrolled: enrollments.length, sent, accepted, replied, positive, byStep };
}

async function withStats(campaign) {
  return { ...campaign, stats: await statsFor(campaign.campaignId) };
}

/* ================================================================== */
/*  Step execution                                                    */
/* ================================================================== */

async function isConnected(publicId) {
  const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: [publicId] }, 'campaign');
  return res.ok && res.data.statuses[publicId] === 'connected';
}

/** Which arm of a branch this person takes. */
export async function chooseBranch(branch, enrollment) {
  const since = enrollment.lastActionAt || enrollment.enrolledAt || 0;
  if (branch.on === 'accepted') return (await isConnected(enrollment.publicId)) ? 0 : 1;
  if (branch.on === 'replied') {
    return (await inbox.repliedSince(enrollment.publicId, since)) ? 0 : 1;
  }
  if (branch.on === 'notAcceptedAfterMs') {
    const elapsed = Date.now() - since;
    if (elapsed < (branch.ms || 0)) return -1; // not yet decidable
    return (await isConnected(enrollment.publicId)) ? 1 : 0;
  }
  return 1;
}

async function stepParams(campaign, step, enrollment) {
  const profile = (await getStoredProfile(enrollment.publicId)) || {
    publicId: enrollment.publicId,
  };
  const variant = pickVariant(step.variants, campaign.variantCursor || 0);
  if (step.variants && step.variants.length) campaign.variantCursor = (campaign.variantCursor || 0) + 1;

  const params = {
    publicId: enrollment.publicId,
    campaignId: campaign.campaignId,
    stepIndex: enrollment.stepIndex,
  };
  if (step.type === 'invite') params.note = renderTemplate(variant || step.note, profile);
  if (step.type === 'message') params.body = renderTemplate(variant || step.body, profile);
  if (step.type === 'inmail') {
    params.body = renderTemplate(variant || step.body, profile);
    params.subject = renderTemplate(step.subject, profile);
  }
  if (step.type === 'like' || step.type === 'comment') {
    params.postUrl = step.postUrl || '';
    if (step.type === 'comment') params.body = renderTemplate(variant || step.body, profile);
  }
  return params;
}

/* ================================================================== */
/*  Tick                                                              */
/* ================================================================== */

/**
 * Move every due enrollment forward.
 * @returns {Promise<{executed: number, queued: number}>}
 */
export async function tick() {
  const campaigns = await readCampaigns();
  const now = Date.now();
  let executed = 0;
  let queued = 0;
  let halted = false;

  for (const campaign of campaigns) {
    if (halted) break;
    if (campaign.status !== 'active') continue;

    const enrollments = await readEnrollments(campaign.campaignId);
    let dirty = false;

    for (const enrollment of enrollments) {
      if (halted) break;
      if (enrollment.status !== 'active') continue;
      if ((enrollment.nextAt || 0) > now) continue;

      if (campaign.settings.stopOnReply) {
        const watermark = enrollment.lastActionAt || enrollment.enrolledAt || 0;
        if (await inbox.repliedSince(enrollment.publicId, watermark)) {
          enrollment.status = 'replied';
          enrollment.updatedAt = now;
          dirty = true;
          continue;
        }
      }

      // One enrollment may resolve several zero-cost steps (branch, wait) in a
      // single tick, but performs at most one write.
      let wrote = false;
      let guard = 0;

      while (!wrote && guard < 20) {
        guard += 1;

        if (isFinished(campaign, enrollment)) {
          await finish(campaign, enrollment);
          dirty = true;
          break;
        }

        const steps = stepsAt(campaign, enrollment.path);
        const step = steps[enrollment.stepIndex];
        if (!step) {
          advance(campaign, enrollment);
          dirty = true;
          continue;
        }

        if (step.type === 'wait') {
          enrollment.nextAt = Date.now() + (step.waitMs || 0);
          advance(campaign, enrollment);
          enrollment.updatedAt = Date.now();
          dirty = true;
          queued += 1;
          break;
        }

        if (step.type === 'branch') {
          const arm = await chooseBranch(step.branch || {}, enrollment);
          if (arm === -1) {
            enrollment.nextAt = Date.now() + 3600000; // look again in an hour
            enrollment.updatedAt = Date.now();
            dirty = true;
            queued += 1;
            break;
          }
          if (arm === 0 && step.branch.on === 'accepted') enrollment.accepted = true;
          enrollment.path = [...enrollment.path, enrollment.stepIndex, arm];
          enrollment.stepIndex = 0;
          enrollment.updatedAt = Date.now();
          dirty = true;
          continue;
        }

        const action = STEP_ACTION[step.type];
        if (!action) {
          advance(campaign, enrollment);
          dirty = true;
          continue;
        }

        const params = await stepParams(campaign, step, enrollment);
        const res = await handle(action, params, 'campaign');
        wrote = true;

        if (!res.ok) {
          if (STOP_THE_TICK.has(res.error.code)) {
            halted = true;
            break;
          }
          // A per-person failure (bad urn, deleted profile) stops that person.
          enrollment.status = 'stopped';
          enrollment.error = res.error.message;
          enrollment.updatedAt = Date.now();
          dirty = true;
          break;
        }

        if (res.data.status === 'sent') executed += 1;
        else queued += 1;

        const doneIndex = enrollment.stepIndex;
        enrollment.lastActionAt = Date.now();
        advance(campaign, enrollment);
        enrollment.updatedAt = Date.now();
        dirty = true;

        await emit(EVENTS.CAMPAIGN_STEP_DONE, {
          campaignId: campaign.campaignId,
          publicId: enrollment.publicId,
          stepIndex: doneIndex,
          type: step.type,
          status: res.data.status,
        });

        if (isFinished(campaign, enrollment)) await finish(campaign, enrollment);
      }
    }

    if (dirty) await writeEnrollments(campaign.campaignId, enrollments);

    const remaining = (await readEnrollments(campaign.campaignId)).filter(
      (e) => e.status === 'active',
    );
    if (!remaining.length && enrollments.length && campaign.status === 'active') {
      campaign.status = 'completed';
      campaign.updatedAt = Date.now();
      await writeCampaigns(campaigns);
    }
  }

  for (const hook of tickHooks) {
    try {
      await hook({ executed, queued, halted });
    } catch {
      /* a hook must not break the tick */
    }
  }

  return { executed, queued };
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

register(ACTIONS.CAMPAIGN_CREATE, (params) => create(params));
register(ACTIONS.CAMPAIGN_GET_ALL, async () => ({ campaigns: await getAll() }));
register(ACTIONS.CAMPAIGN_GET, ({ campaignId }) => getOne(campaignId));
register(ACTIONS.CAMPAIGN_ENROLL, ({ campaignId, publicIds }) => enroll(campaignId, publicIds));
register(ACTIONS.CAMPAIGN_PAUSE, ({ campaignId }) => setStatus(campaignId, 'paused'));
register(ACTIONS.CAMPAIGN_RESUME, ({ campaignId }) => setStatus(campaignId, 'active'));
register(ACTIONS.CAMPAIGN_DELETE, ({ campaignId }) => del(campaignId));
register(ACTIONS.CAMPAIGN_TICK, () => tick());
