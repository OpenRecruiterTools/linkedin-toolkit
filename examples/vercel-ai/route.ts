/**
 * Vercel AI SDK · LinkedIn Toolkit
 *
 * A Next.js App Router route handler that streams a chat with LinkedIn tools attached.
 * Drop this at app/api/chat/route.ts.
 *
 *   npm i ai @ai-sdk/openai zod
 *   export OPENAI_API_KEY=sk-...
 *   export LINKEDIN_TOOLKIT_TOKEN=$(jq -r '.token' ~/.linkedin-toolkit/config.json)
 *
 * The toolkit runs on the user's own machine, so this route only works for a locally-run app.
 * If you deploy it, the server has no access to 127.0.0.1:47830 — which is the point. See the
 * README for the tunnel pattern if you genuinely need a remote agent.
 */

import { openai } from '@ai-sdk/openai';
import { streamText, tool, type UIMessage, convertToModelMessages } from 'ai';
import { z } from 'zod';

export const maxDuration = 60;

const BASE = process.env.LINKEDIN_TOOLKIT_URL ?? 'http://127.0.0.1:47830';
const TOKEN = process.env.LINKEDIN_TOOLKIT_TOKEN!;

type Envelope<T> =
  | { ok: true; data: T; rateLimit?: Record<string, number> }
  | { ok: false; error: { code: string; message: string; retryAfter?: number; howToFix?: string } };

async function action<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BASE}/actions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(params),
    cache: 'no-store',
  });
  const envelope = (await res.json()) as Envelope<T>;
  if (!envelope.ok) {
    throw new Error(
      `${envelope.error.code}: ${envelope.error.message}` +
        (envelope.error.howToFix ? ` — ${envelope.error.howToFix}` : ''),
    );
  }
  return envelope.data;
}

export const linkedinTools = {
  linkedin_get_status: tool({
    description:
      'Connection state, login state, Copilot/Autopilot mode, business hours, remaining quota per action type, queue depth. Call before anything else.',
    inputSchema: z.object({}),
    execute: () => action('status.get'),
  }),

  linkedin_search_people: tool({
    description: 'Search LinkedIn for people. count is capped at 100 per call; page with nextStart.',
    inputSchema: z.object({
      keywords: z.string().describe('Free-text search terms'),
      title: z.string().optional(),
      company: z.string().optional(),
      location: z.string().optional(),
      source: z.enum(['search', 'salesnav', 'recruiter']).optional(),
      start: z.number().int().optional(),
      count: z.number().int().max(100).optional(),
    }),
    execute: (params) => action('search.people', params),
  }),

  linkedin_get_profile: tool({
    description:
      'One profile by publicId or url. full:true adds page text and photo and spends one profile visit from the daily cap.',
    inputSchema: z.object({
      publicId: z.string().optional(),
      url: z.string().optional(),
      full: z.boolean().optional(),
    }),
    execute: (params) => action('profile.get', params),
  }),

  linkedin_get_connection_status: tool({
    description: 'Batch connection check: connected, pending, or none. Call before drafting invites.',
    inputSchema: z.object({ publicIds: z.array(z.string()) }),
    execute: (params) => action('network.status', params),
  }),

  linkedin_send_invite: tool({
    description:
      'Send a connection invite with an optional note (200 characters max — LinkedIn\'s limit; a longer note is refused with INVALID_PARAMS). In Copilot mode — the default — this QUEUES for human approval and returns {status:"queued", queueId}. That is success. dry_run:true returns what would be sent without queuing.',
    inputSchema: z.object({
      publicId: z.string(),
      note: z.string().max(300).optional(),
      dry_run: z.boolean().optional(),
    }),
    execute: (params) => action('outreach.invite', params),
  }),

  linkedin_queue_list: tool({
    description: 'What is waiting for the human in the approval queue.',
    inputSchema: z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'sent']).optional(),
    }),
    execute: (params) => action('queue.list', params),
  }),
};

const SYSTEM = `You help the user source and reach out to people on LinkedIn.

Always call linkedin_get_status first and respect what it tells you about quota and mode.
Never invent a fact, a publicId, or a reason to reach out — everything you say about a person must
come from a tool result. Invite notes are 200 characters maximum (aim for 180) and must hang on something
specific from that person's own profile.

Writes queue for human approval unless the user has turned Autopilot on themselves in the
extension. Tell the user their drafts are in the queue; never claim anything was sent unless the
result said status "sent".

RATE_LIMITED, QUOTA_EXCEEDED and CHALLENGE_DETECTED are terminal. Report them and stop — do not
retry, and do not look for another route to the same action.`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: openai('gpt-4.1'),
    system: SYSTEM,
    messages: convertToModelMessages(messages),
    tools: linkedinTools,
    stopWhen: ({ steps }) => steps.length >= 20,
  });

  return result.toUIMessageStreamResponse();
}
