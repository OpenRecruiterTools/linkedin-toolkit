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
import { getStoredProfile, logAction } from '../lib/storage.js';
import { register, setRateLimitProvider } from './engine.js';
import * as queue from './queue.js';
import * as quota from './quota.js';
import * as voyager from './voyager.js';

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
  [ACTIONS.OUTREACH_VIEW]: ({ publicId }) => voyager.viewProfile(publicId),
  [ACTIONS.OUTREACH_FOLLOW]: ({ publicId, profileUrn }) => voyager.follow({ publicId, profileUrn }),
  [ACTIONS.OUTREACH_INVITE]: ({ publicId, note, profileUrn }) =>
    voyager.sendInvite({ publicId, note, profileUrn }),
  [ACTIONS.OUTREACH_MESSAGE]: async ({ publicId, body, recipientUrn }) =>
    voyager.sendMessage({
      recipientUrn: recipientUrn || (await voyager.resolveProfileUrn(publicId)),
      body,
    }),
  [ACTIONS.OUTREACH_INMAIL]: async ({ publicId, subject, body, recipientUrn }) =>
    voyager.sendInMail({
      recipientUrn: recipientUrn || (await voyager.resolveProfileUrn(publicId)),
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
  await quota.check(kind);
  await quota.humanDelay();

  await SENDERS[action](params);

  await quota.record(kind);
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

queue.setExecutor((action, params) => send(action, params, 'approved'));

// The engine reports the bucket's RateLimit back on every outreach envelope.
setRateLimitProvider(quota.snapshot);

/* ================================================================== */
/*  Policy                                                            */
/* ================================================================== */

function isDryRun(params) {
  return params.dry_run === true || params.dryRun === true;
}

function cleanParams(params) {
  const out = { ...params };
  delete out.dry_run;
  delete out.dryRun;
  return out;
}

/**
 * Apply the origin rules to one outreach action.
 * @returns {Promise<{status: 'sent'|'queued'|'dryRun', queueId?, wouldSend?, sentAt?}>}
 */
export async function dispatch(action, rawParams, origin) {
  const params = cleanParams(rawParams);

  if (isDryRun(rawParams)) {
    return { status: 'dryRun', wouldSend: { action, params } };
  }

  const context = {};
  if (rawParams.campaignId) {
    context.campaignId = rawParams.campaignId;
    context.stepIndex = rawParams.stepIndex;
  }

  if (DIRECT_ORIGINS.has(origin) || !queue.isQueueable(action)) {
    return send(action, params, origin, context);
  }

  const config = await getConfig();
  if (config.autopilot) return send(action, params, origin, context);

  const profile = params.publicId ? await getStoredProfile(params.publicId) : null;
  const item = await queue.enqueue(action, params, origin, profile);
  return { status: 'queued', queueId: item.id };
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

for (const action of Object.keys(SENDERS)) {
  register(action, (params, ctx) => dispatch(action, params, ctx.origin));
}
