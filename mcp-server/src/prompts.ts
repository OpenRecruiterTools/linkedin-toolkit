/**
 * MCP prompts: `source-candidates`, `write-opener`, `triage-inbox`.
 *
 * Each one is a short operating procedure that names the exact tools to call in
 * order, so an agent does not have to guess the workflow.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Toolkit } from './toolkit.js';

function userMessage(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

export function registerPrompts(server: McpServer, _toolkit: Toolkit): void {
  server.registerPrompt(
    'source-candidates',
    {
      title: 'Source candidates',
      description: 'Source and shortlist people on LinkedIn from a short brief, saving them to a list.',
      argsSchema: {
        brief: z.string().describe('Who you are looking for, in a sentence or two.'),
        count: z.string().optional().describe('How many people to shortlist. Default 25.'),
      },
    },
    ({ brief, count }) =>
      userMessage(
        [
          `Source LinkedIn candidates for this brief:\n\n${brief}\n`,
          `Target shortlist size: ${count ?? '25'}.`,
          '',
          'Work in this order:',
          '1. linkedin_get_status — confirm the extension is connected and check the remaining search quota.',
          '2. linkedin_search_people — translate the brief into keywords plus title, company and location filters. Page with nextStart until you have enough, staying inside the daily search cap.',
          '3. linkedin_get_connection_status — for the shortlist, so you know who is already a first-degree connection.',
          '4. linkedin_list_create then linkedin_list_add — save the shortlist under a name that describes the brief.',
          '',
          'Then report the list name and id, how many people it holds, and a table of the shortlist with name, headline, company, location and connection status. Flag anyone whose fit you are unsure about rather than padding the list. Do not send any invite or message unless the human asks for one.',
        ].join('\n'),
      ),
  );

  server.registerPrompt(
    'write-opener',
    {
      title: 'Write an opener',
      description: 'Draft a short, specific connection-request opener for one person.',
      argsSchema: {
        publicId: z.string().describe('The LinkedIn publicId, e.g. ada-lovelace.'),
        tone: z.string().optional().describe('warm, direct, peer-to-peer, formal. Default warm.'),
      },
    },
    ({ publicId, tone }) =>
      userMessage(
        [
          `Draft a connection-request opener for LinkedIn profile "${publicId}".`,
          `Tone: ${tone ?? 'warm'}.`,
          '',
          'Work in this order:',
          `1. linkedin_get_profile with publicId "${publicId}" and full=true, so the note can reference something real.`,
          '2. Optionally linkedin_get_connection_status to check they are not already connected.',
          '',
          'Rules for the note: under 300 characters (LinkedIn will reject longer), no flattery, no "I came across your profile", one concrete detail from their profile, and one clear reason to connect. Offer two variants and say which you would send.',
          '',
          'Show the draft and stop. Do not call linkedin_send_invite — the human decides.',
        ].join('\n'),
      ),
  );

  server.registerPrompt(
    'triage-inbox',
    {
      title: 'Triage inbox',
      description: 'Triage recent LinkedIn replies into positive, neutral and negative buckets.',
      argsSchema: {
        since: z
          .string()
          .optional()
          .describe('How far back to look: an epoch milliseconds value, or e.g. 24h or 7d.'),
      },
    },
    ({ since }) =>
      userMessage(
        [
          `Triage the LinkedIn inbox${since ? ` for everything since ${since}` : ' for the last 7 days'}.`,
          '',
          'Work in this order:',
          '1. linkedin_get_conversations — with the since window, to list threads.',
          '2. linkedin_get_messages — for each thread that looks like a reply worth reading.',
          '',
          'Bucket every thread as positive (wants to talk), neutral (asked a question or needs nurturing) or negative (not interested, asked to stop). For each positive thread suggest a one-paragraph reply. For each negative thread say explicitly that the person should be removed from any running campaign, and name the campaign if you can find it with linkedin_campaign_list.',
          '',
          'Report a table of thread, person, bucket and suggested next step. Send nothing yourself.',
        ].join('\n'),
      ),
  );
}
