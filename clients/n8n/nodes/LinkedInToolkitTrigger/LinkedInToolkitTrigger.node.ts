import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';

/**
 * The 11 event names the server emits, verbatim from the contract.
 * `challenge_detected` is the one worth an alert rather than a log: every write
 * is paused until a human clears the challenge in Chrome.
 */
export const EVENTS = [
	'invite_accepted',
	'reply_received',
	'positive_reply',
	'campaign_step_done',
	'campaign_completed',
	'quota_hit',
	'challenge_detected',
	'queue_item_added',
	'queue_item_sent',
	'campaign_note_truncated',
	'research_progress',
	'research_completed',
] as const;

export type EventName = (typeof EVENTS)[number];

const EVENT_DESCRIPTIONS: Record<EventName, string> = {
	invite_accepted: 'A connection invite was accepted. Good moment to draft a first message.',
	reply_received: 'Someone replied in the inbox.',
	positive_reply: 'A reply the engine scored as positive.',
	campaign_step_done: 'A campaign step finished for one enrolled person.',
	campaign_completed: 'A campaign finished.',
	quota_hit: 'A daily or hourly cap was reached. The engine working as intended, not an error.',
	challenge_detected:
		'LinkedIn raised a security challenge. Page someone: writes stay paused until a human clears it in Chrome.',
	queue_item_added: 'A write was queued for human approval.',
	queue_item_sent: 'An approved write was sent.',
	campaign_note_truncated:
		'A campaign invite note rendered longer than LinkedIn allows and was cut at a word boundary. Shorten the template.',
	research_progress: 'One row of a Research Pack job finished.',
	research_completed: 'A Research Pack job finished.',
};

/**
 * Decide whether one delivery should start the workflow.
 *
 * Split out from `webhook()` so the filter can be tested without an n8n
 * execution context; an empty selection means every event, which is what the
 * "leave it blank" default in the panel implies.
 */
export function shouldTrigger(event: unknown, selected: string[]): boolean {
	if (selected.length === 0) return true;
	return typeof event === 'string' && selected.includes(event);
}

export class LinkedInToolkitTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LinkedIn Toolkit Trigger',
		name: 'linkedInToolkitTrigger',
		icon: 'file:linkedInToolkit.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].length ? $parameter["events"].join(", ") : "all events"}}',
		description: 'Starts a workflow when the LinkedIn Toolkit server emits an event',
		defaults: { name: 'LinkedIn Toolkit Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'linkedInToolkitApi', required: false }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Copy this node\'s Production URL, then point the server at it: <code>lit config set webhookUrl &lt;url&gt;</code>. The server posts <code>{ event, payload, at }</code> and retries at 1 s, 5 s and 25 s.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				default: [],
				description: 'Which events start the workflow. Leave empty for all of them.',
				options: EVENTS.map((event) => ({
					name: event,
					value: event,
					description: EVENT_DESCRIPTIONS[event],
				})),
			},
			{
				displayName: 'Payload Only',
				name: 'payloadOnly',
				type: 'boolean',
				default: false,
				description:
					'Whether to output just the event payload instead of the whole `{event, payload, at}` delivery',
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = (this.getBodyData() ?? {}) as IDataObject;
		const selected = this.getNodeParameter('events', []) as string[];

		if (!shouldTrigger(body.event, selected)) {
			// Answer the server so it does not retry, but do not start the workflow.
			return { webhookResponse: { ok: true, ignored: body.event ?? null } };
		}

		const payloadOnly = this.getNodeParameter('payloadOnly', false) as boolean;
		const json =
			payloadOnly && body.payload && typeof body.payload === 'object'
				? (body.payload as IDataObject)
				: body;

		return {
			webhookResponse: { ok: true },
			workflowData: [this.helpers.returnJsonArray([json])],
		};
	}
}
