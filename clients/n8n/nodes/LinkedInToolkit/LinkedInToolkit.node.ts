import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import type { ActionSpec, FieldSpec } from './actions.generated';
import { ACTION_BY_NAME, NODE_PROPERTIES } from './properties';

/**
 * Turn one n8n field value into the JSON the contract expects.
 *
 * Only three shapes need work: a comma-separated string becomes an array, a
 * JSON field is parsed, and an empty optional is dropped rather than sent as
 * `""`, which the server would reject as an invalid param.
 */
export function coerce(
	field: FieldSpec,
	value: unknown,
	context: { nodeName: string },
): unknown | undefined {
	if (value === undefined || value === null) return undefined;

	if (field.type === 'stringList') {
		if (typeof value !== 'string') return Array.isArray(value) ? value : undefined;
		const items = value
			.split(',')
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
		return items.length > 0 ? items : undefined;
	}

	if (field.type === 'json') {
		if (typeof value !== 'string') return value;
		const trimmed = value.trim();
		if (trimmed === '' || trimmed === '{}' || trimmed === '[]') return undefined;
		try {
			return JSON.parse(trimmed);
		} catch {
			throw new Error(
				`${context.nodeName}: "${field.displayName}" is not valid JSON. Expected ${
					field.default === '[]' ? 'an array' : 'an object'
				}.`,
			);
		}
	}

	if (field.type === 'string' && value === '') return undefined;

	return value;
}

/** Build the request body for one action from the node's parameters. */
export function buildParams(
	action: ActionSpec,
	read: (name: string) => unknown,
	nodeName = 'LinkedIn Toolkit',
): IDataObject {
	const params: IDataObject = {};

	for (const field of action.required) {
		const value = coerce(field, read(field.name), { nodeName });
		if (value !== undefined) params[field.key] = value;
	}

	const extra = (read(`${action.key}_extra`) ?? {}) as IDataObject;
	for (const field of action.optional) {
		const value = coerce(field, extra[field.name], { nodeName });
		if (value !== undefined) params[field.key] = value;
	}

	return params;
}

export class LinkedInToolkit implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LinkedIn Toolkit',
		name: 'linkedInToolkit',
		icon: 'file:linkedInToolkit.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Search, read and act on LinkedIn through your own logged-in Chrome session. Hard caps and the approval queue live in the extension and cannot be raised from here.',
		defaults: { name: 'LinkedIn Toolkit' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'linkedInToolkitApi', required: true }],
		requestDefaults: {
			headers: { 'content-type': 'application/json' },
		},
		properties: NODE_PROPERTIES,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('linkedInToolkitApi');
		const baseUrl = String(credentials.baseUrl ?? 'http://127.0.0.1:47830').replace(/\/+$/, '');

		for (let index = 0; index < items.length; index++) {
			const operation = this.getNodeParameter('operation', index) as string;
			const action = ACTION_BY_NAME.get(operation);

			if (!action) {
				throw new NodeOperationError(
					this.getNode(),
					`Unknown operation "${operation}". Reinstall n8n-nodes-linkedin-toolkit if this node is older than your server.`,
					{ itemIndex: index },
				);
			}

			let params: IDataObject;
			try {
				params = buildParams(action, (name) => this.getNodeParameter(name, index, undefined));
			} catch (error) {
				throw new NodeOperationError(this.getNode(), (error as Error).message, {
					itemIndex: index,
				});
			}

			const response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'linkedInToolkitApi',
				{
					method: 'POST',
					url: `${baseUrl}/actions/${action.action}`,
					body: params,
					json: true,
					// The server answers an engine failure with HTTP 200 and
					// `ok: false`, so a non-2xx here is a transport or auth problem
					// and we want to read the body either way.
					returnFullResponse: false,
					ignoreHttpStatusErrors: true,
				},
			)) as IDataObject;

			if (response?.ok === true) {
				const full = this.getNodeParameter('fullEnvelope', index, false) as boolean;
				const data = response.data;
				const json: IDataObject = full
					? response
					: data && typeof data === 'object' && !Array.isArray(data)
						? (data as IDataObject)
						: { data };
				output.push({ json, pairedItem: { item: index } });
				continue;
			}

			const failure = (response?.error ?? {
				code: 'INTERNAL',
				message: 'The server returned an unrecognised body.',
			}) as IDataObject;

			if (this.continueOnFail()) {
				output.push({
					json: { error: failure.code, message: failure.message, howToFix: failure.howToFix },
					pairedItem: { item: index },
				});
				continue;
			}

			throw new NodeApiError(this.getNode(), failure as unknown as JsonObject, {
				message: `${failure.code}: ${failure.message}`,
				description: (failure.howToFix as string) ?? undefined,
				itemIndex: index,
			});
		}

		return [output];
	}
}
