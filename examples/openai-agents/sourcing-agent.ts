/**
 * OpenAI Agents SDK · LinkedIn Toolkit
 *
 * A sourcing agent with five tools. Reads are unrestricted; the one write tool relies on the
 * engine's Copilot mode, which queues every agent-originated invite for human approval.
 *
 *   npm install
 *   export OPENAI_API_KEY=sk-...
 *   export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.token' ~/.linkedin-toolkit/config.json)
 *   npx tsx sourcing-agent.ts "Heads of data engineering at Series B fintechs in London"
 *
 * Requires `lit serve --http` (add --fake to run without a LinkedIn account).
 */

import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';

const BASE = process.env.LINKEDIN_TOOLKIT_URL ?? 'http://127.0.0.1:47830';
const TOKEN = process.env.LINKEDIN_TOOLKIT_TOKEN;

if (!TOKEN) {
  console.error('LINKEDIN_TOOLKIT_TOKEN is not set. It is the bridge token in ~/.linkedin-toolkit/config.json');
  process.exit(1);
}

/** Every tool goes through here. One place to handle the envelope, one place to handle errors. */
async function action<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BASE}/actions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(params),
  });

  const envelope = (await res.json()) as
    | { ok: true; data: T; rateLimit?: Record<string, number> }
    | { ok: false; error: { code: string; message: string; retryAfter?: number; howToFix?: string } };

  if (!envelope.ok) {
    // Hand the agent the structured error verbatim. These are terminal, not retryable:
    // RATE_LIMITED carries retryAfter, QUOTA_EXCEEDED means the day is done, and
    // CHALLENGE_DETECTED means stop everything and tell the human.
    throw new Error(
      `${envelope.error.code}: ${envelope.error.message}` +
        (envelope.error.howToFix ? ` — ${envelope.error.howToFix}` : ''),
    );
  }
  return envelope.data;
}

const getStatus = tool({
  name: 'linkedin_get_status',
  description:
    'Connection state, login state, Copilot/Autopilot mode, business hours, remaining daily and hourly quota per action type, queue depth. Call this before anything else.',
  parameters: z.object({}),
  execute: () => action('status.get').then((d) => JSON.stringify(d)),
});

const searchPeople = tool({
  name: 'linkedin_search_people',
  description:
    'Search LinkedIn for people. Returns normalised profiles. count is capped at 100 per call; page with the returned nextStart.',
  parameters: z.object({
    keywords: z.string(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    source: z.enum(['search', 'salesnav', 'recruiter']).nullable(),
    start: z.number().int().nullable(),
    count: z.number().int().max(100).nullable(),
  }),
  execute: (p) => action('search.people', stripNulls(p)).then((d) => JSON.stringify(d)),
});

const getProfile = tool({
  name: 'linkedin_get_profile',
  description:
    'One profile by publicId or URL. full:true adds page text and photo and spends one profile visit from the daily cap.',
  parameters: z.object({
    publicId: z.string().nullable(),
    url: z.string().nullable(),
    full: z.boolean().nullable(),
  }),
  execute: (p) => action('profile.get', stripNulls(p)).then((d) => JSON.stringify(d)),
});

const getConnectionStatus = tool({
  name: 'linkedin_get_connection_status',
  description:
    'Batch check whether you are connected, have a pending invite, or have no relationship. Always call this before drafting invites.',
  parameters: z.object({ publicIds: z.array(z.string()) }),
  execute: (p) => action('network.status', p).then((d) => JSON.stringify(d)),
});

const sendInvite = tool({
  name: 'linkedin_send_invite',
  description:
    'Send a connection invite with an optional note (300 characters maximum). In Copilot mode — the default — this QUEUES the invite for human approval and returns {status:"queued", queueId}. That is success, not failure. Pass dry_run:true to see what would be sent without queuing anything.',
  parameters: z.object({
    publicId: z.string(),
    note: z.string().max(300).nullable(),
    dry_run: z.boolean().nullable(),
  }),
  execute: (p) => action('outreach.invite', stripNulls(p)).then((d) => JSON.stringify(d)),
});

function stripNulls(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

const agent = new Agent({
  name: 'LinkedIn Sourcer',
  model: 'gpt-4.1',
  instructions: `You source people on LinkedIn through the LinkedIn Toolkit.

Order of work:
1. linkedin_get_status. If connected or loggedIn is false, or a challenge is set, stop and say so.
   Read the search and invite quota and plan inside it.
2. Two to four searches with varied title synonyms, not one broad query.
3. Deduplicate by publicId across your own results.
4. linkedin_get_connection_status on the survivors. Never draft an invite for someone already
   connected or already pending.
5. Score against the brief using only fields the tools returned. One line of reasoning each.
6. linkedin_get_profile with full:true for the finalists only — each one costs visit quota.
7. Draft invite notes under 300 characters, each hanging on a specific fact from that person's
   own profile. No flattery, no "I came across your profile", no invented facts.
8. dry_run the first invite and show it before queuing the rest.

Rules you do not break:
- Never invent a fact, a publicId, a company, or a tenure. Missing means you say it is missing.
- Never retry after RATE_LIMITED, QUOTA_EXCEEDED, or CHALLENGE_DETECTED. Report and stop.
- Writes queue for human approval. Say so. Never claim something was sent unless the result
  said status "sent".`,
  tools: [getStatus, searchPeople, getProfile, getConnectionStatus, sendInvite],
});

const brief = process.argv.slice(2).join(' ');
if (!brief) {
  console.error('usage: npx tsx sourcing-agent.ts "<brief>"');
  process.exit(1);
}

const result = await run(agent, `Source 20 people for this brief and draft invites for the top 8: ${brief}`);
console.log(result.finalOutput);
