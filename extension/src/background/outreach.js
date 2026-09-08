/**
 * LinkedIn Toolkit — the write path.
 *
 * One rule for every outreach action, whatever asked for it:
 *
 *   dry_run          → { status: 'dryRun', wouldSend }, no quota, no queue
 *   popup / approved → send now
 *   anything else    → queue for approval, unless config.autopilot is on
 *
 * A send is always: quota.check(kind) → humanDelay() → the Voyager call →
 * quota.record(kind) → an entry in the `actions` log. That log is what
 * `contactedBefore`, campaign stats and `sync.pull` read.
 */

import { ACTIONS } from '../lib/actions.js';
import { getConfig } from '../lib/config.js';
import { getStoredProfile, logAction, putProfile } from '../lib/storage.js';
import { register, setRateLimitProvider } from './engine.js';
import * as queue from './queue.js';
import * as quota from './quota.js';
import * as voyager from './voyager.js';
import { meteredProfileUrn } from './visits.js';

/** Which quota bucket each action draws from. */
export const QUOTA_KIND = Object.freeze({
  [ACTIONS.OUTREACH_INVITE]: 'invite',
  [ACTIONS.OUTREACH_MESSAGE]: 'message',
  [ACTIONS.OUTREACH_INMAIL]: 'message',
  [ACTIONS.OUTREACH_VIEW]: 'visit',
  [ACTIONS.OUTREACH_FOLLOW]: 'visit',
  [ACTIONS.OUTREACH_LIKE]: 'visit',
  [ACTIONS.OUTREACH_COMMENT]: 'visit',
});

/** Origins whose writes go straight to LinkedIn. */
const DIRECT_ORIGINS = new Set(['popup', 'approved']);

/* ================================================================== */
/*  The LinkedIn calls                                                */
/* ================================================================== */

const SENDERS = {
  // A view already reserved its visit in send(); storing what it read means
  // the follow or message after it does not pay for a second one.
  [ACTIONS.OUTREACH_VIEW]: async ({ publicId }) => {
    const profile = await voyager.viewProfile(publicId);
    await putProfile({ ...profile, profileViewedAt: Date.now() });
    return profile;
  },
  [ACTIONS.OUTREACH_FOLLOW]: async ({ publicId, profileUrn }) =>
    voyager.follow({ publicId, profileUrn: profileUrn || (await meteredProfileUrn(publicId)) }),
  [ACTIONS.OUTREACH_INVITE]: async ({ publicId, note, profileUrn }) =>
    voyager.sendInvite({
      publicId,
      note,
      profileUrn: profileUrn || (await meteredProfileUrn(publicId)),
    }),
  // Resolving a urn from a public id is a profileView, so it is metered as a
  // visit on top of the message's own bucket.
  [ACTIONS.OUTREACH_MESSAGE]: async ({ publicId, body, recipientUrn }) =>
    voyager.sendMessage({
      recipientUrn: recipientUrn || (await meteredProfileUrn(publicId)),
      body,
    }),
  [ACTIONS.OUTREACH_INMAIL]: async ({ publicId, subject, body, recipientUrn }) =>
    voyager.sendInMail({
      recipientUrn: recipientUrn || (await meteredProfileUrn(publicId)),
      subject,
      body,
    }),
  [ACTIONS.OUTREACH_LIKE]: ({ postUrl }) => voyager.likePost({ postUrl }),
  [ACTIONS.OUTREACH_COMMENT]: ({ postUrl, body }) => voyager.commentPost({ postUrl, body }),
};

/**
 * Actually send. Used directly by the popup path and by `queue.approve`.
 * @returns {Promise<{status: 'sent', sentAt: number}>}
 */
export async function send(action, params, origin = 'approved', context = {}) {
  const kind = QUOTA_KIND[action];
  // Reserve, do not check-then-record: two concurrent sends that both read
  // `daily = cap - 1` would otherwise both pass.
  await quota.reserve(kind);
  await quota.humanDelay();

  await SENDERS[action](params);

  const result = { status: 'sent', sentAt: Date.now() };
  await logAction({
    action,
    publicId: params.publicId || '',
    origin,
    result,
    ...context,
  });
  return result;
}

queue.setExecutor((action, params, context) => send(action, params, 'approved', context));

// The engine reports the bucket's RateLimit back on every outreach envelope.
setRateLimitProvider(quota.snapshot);

/* ================================================================== */
/*  Policy                                                            */
/* ================================================================== */

function isDryRun(params) {
  return params.dry_run === true || params.dryRun === true;
}

/**
 * Split the caller's params into what LinkedIn is asked for and what only the
 * engine cares about. The campaign fields have to survive a spell in the
 * approval queue, or the action log written on approval cannot be attributed
 * and the campaign's stats read zero.
 */
function splitParams(params) {
  const rest = { ...params };
  const { campaignId, stepIndex } = rest;
  delete rest.dry_run;
  delete rest.dryRun;
  delete rest.campaignId;
  delete rest.stepIndex;

  const context = {};
  if (campaignId) {
    context.campaignId = campaignId;
    if (stepIndex !== undefined) context.stepIndex = stepIndex;
  }
  return { params: rest, context };
}

/**
 * Apply the origin rules to one outreach action.
 * @returns {Promise<{status: 'sent'|'queued'|'dryRun', queueId?, wouldSend?, sentAt?}>}
 */
export async function dispatch(action, rawParams, origin) {
  const { params, context } = splitParams(rawParams);

  if (isDryRun(rawParams)) {
    return { status: 'dryRun', wouldSend: { action, params } };
  }

  if (DIRECT_ORIGINS.has(origin) || !queue.isQueueable(action)) {
    return send(action, params, origin, context);
  }

  const config = await getConfig();
  if (config.autopilot) return send(action, params, origin, context);

  const profile = params.publicId ? await getStoredProfile(params.publicId) : null;
  const item = await queue.enqueue(action, params, origin, profile, context);
  return { status: 'queued', queueId: item.id };
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

for (const action of Object.keys(SENDERS)) {
  register(action, (params, ctx) => dispatch(action, params, ctx.origin));
}
