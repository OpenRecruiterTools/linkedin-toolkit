/**
 * UI test helpers: a stubbed engine that answers `chrome.runtime.sendMessage`
 * with contract-shaped envelopes, plus the fixtures the tabs render from.
 *
 * Nothing here touches the real engine — WS-C is tested purely against the
 * contract, exactly as the popup sees it.
 */

import { ACTIONS } from '../../src/lib/actions.js';

/**
 * Replace `chrome.runtime.sendMessage` with a stub.
 *
 * @param {Record<string, Function|object>} handlers action → data, envelope,
 *        or a function receiving `params` and returning either.
 * @returns {{ calls: object[], paramsFor(action): object|undefined,
 *             allParamsFor(action): object[], countOf(action): number }}
 */
export function stubEngine(handlers = {}) {
  const calls = [];

  chrome.runtime.sendMessage = (msg, callback) => {
    calls.push(msg);
    const entry = handlers[msg.action];
    let response;
    if (entry === undefined) {
      response = {
        ok: false,
        error: { code: 'NOT_FOUND', message: `no stub for ${msg.action}` },
      };
    } else {
      const out = typeof entry === 'function' ? entry(msg.params || {}, msg) : entry;
      response = out && typeof out.ok === 'boolean' ? out : { ok: true, data: out };
    }
    Promise.resolve().then(() => callback(response));
    return undefined;
  };

  return {
    calls,
    countOf: (action) => calls.filter((c) => c.action === action).length,
    paramsFor: (action) => {
      const hit = calls.filter((c) => c.action === action).pop();
      return hit ? hit.params : undefined;
    },
    allParamsFor: (action) => calls.filter((c) => c.action === action).map((c) => c.params),
  };
}

/** Let queued microtasks (and the odd timer) run. */
export async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A fresh `<div>` attached to the document, used as a tab container. */
export function mountPoint() {
  document.body.textContent = '';
  const node = document.createElement('div');
  document.body.appendChild(node);
  return node;
}

/** Click a node found by text (exact, trimmed). */
export function clickText(root, text, selector = 'button') {
  const node = [...root.querySelectorAll(selector)].find(
    (n) => n.textContent.trim() === text || n.textContent.trim().startsWith(text),
  );
  if (!node)
    throw new Error(`No ${selector} labelled "${text}" in ${root.textContent.slice(0, 200)}`);
  node.click();
  return node;
}

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

export const rateLimit = (used = 0, cap = 25) => ({
  hourlyUsed: Math.min(used, 5),
  hourlyCap: 20,
  dailyUsed: used,
  dailyCap: cap,
  nextAllowedAt: 0,
});

export function statusFixture(overrides = {}) {
  return {
    connected: true,
    extensionVersion: '2.0.0',
    loggedIn: true,
    autopilot: false,
    businessHours: true,
    quotas: {
      invite: rateLimit(6, 25),
      message: rateLimit(3, 50),
      visit: rateLimit(40, 200),
      search: rateLimit(2, 300),
    },
    queue: { pending: 2 },
    campaigns: { active: 1, paused: 1 },
    ...overrides,
  };
}

export function configFixture(overrides = {}) {
  return {
    minDelayMs: 8000,
    maxDelayMs: 15000,
    hourlyCap: 20,
    dailyInviteCap: 25,
    dailyMessageCap: 50,
    dailyVisitCap: 200,
    dailySearchCap: 300,
    businessHoursOnly: true,
    businessStart: 9,
    businessEnd: 18,
    weekdaysOnly: true,
    autopilot: false,
    accountPreset: 'free',
    warmup: { enabled: false, days: 14 },
    ai: { provider: 'none' },
    bridge: { enabled: false, port: 47829 },
    ...overrides,
  };
}

export function profileFixture(publicId = 'ada', overrides = {}) {
  return {
    publicId,
    url: `https://www.linkedin.com/in/${publicId}/`,
    firstName: 'Ada',
    lastName: 'Lovelace',
    fullName: 'Ada Lovelace',
    headline: 'Analytical engines',
    title: 'Engineer',
    company: 'Analytical Engine Co',
    location: 'London',
    capturedAt: 1_757_000_000_000,
    ...overrides,
  };
}

export function listFixture(overrides = {}) {
  return {
    listId: 'l1',
    name: 'Founders',
    tags: ['warm'],
    createdAt: 1_757_000_000_000,
    count: 2,
    ...overrides,
  };
}

export function campaignFixture(overrides = {}) {
  return {
    campaignId: 'c1',
    name: 'Warm connect',
    status: 'active',
    createdAt: 1_757_000_000_000,
    steps: [
      { type: 'view' },
      { type: 'wait', waitMs: 86_400_000 },
      { type: 'invite', note: 'Hi {{firstName|there}}' },
    ],
    settings: { stopOnReply: true, autopilot: false },
    stats: {
      enrolled: 10,
      sent: 6,
      accepted: 2,
      replied: 1,
      positive: 1,
      byStep: { 0: { sent: 6 }, 2: { sent: 4, accepted: 2 } },
    },
    ...overrides,
  };
}

export function queueItemFixture(overrides = {}) {
  return {
    id: 'q1',
    action: ACTIONS.OUTREACH_INVITE,
    params: { publicId: 'ada', note: 'Hi Ada' },
    origin: 'campaign',
    profile: profileFixture(),
    createdAt: 1_757_000_000_000,
    status: 'pending',
    ...overrides,
  };
}

export function threadFixture(overrides = {}) {
  return {
    threadId: 't1',
    participants: [{ publicId: 'ada', fullName: 'Ada Lovelace' }],
    lastMessageAt: 1_757_000_000_000,
    unread: true,
    snippet: 'Sounds good — send it over.',
    sentiment: 'positive',
    ...overrides,
  };
}
