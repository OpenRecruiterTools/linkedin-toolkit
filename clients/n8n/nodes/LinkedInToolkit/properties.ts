import type { INodeProperties } from 'n8n-workflow';

import { ACTIONS, RESOURCES, type ActionSpec, type FieldSpec } from './actions.generated';

/**
 * The node's parameter list, built from the generated action table.
 *
 * Written as a function of the contract rather than as 51 hand-maintained
 * blocks: with a hundred-odd fields across eighteen resources, a hand-written
 * list is a list that goes stale.
 *
 * Two conventions:
 *
 * * a parameter's `name` is prefixed with the action (`search_people_keywords`),
 *   because n8n stores parameter values in one flat object per node and two
 *   operations that share a field name but not its type would otherwise share
 *   a stored value;
 * * required fields sit at the top level, everything else — including
 *   `dry_run` — goes in one "Additional Fields" collection per operation, which
 *   is what keeps the panel readable.
 */

function displayFor(action: ActionSpec): { resource: string[]; operation: string[] } {
	return { resource: [action.resource], operation: [action.action] };
}

function baseProperty(field: FieldSpec, action: ActionSpec): INodeProperties {
	const shared = {
		displayName: field.displayName,
		name: field.name,
		description: field.description,
		required: field.required,
	};

	switch (field.type) {
		case 'number':
			return { ...shared, type: 'number', default: field.default as number };
		case 'boolean':
			return { ...shared, type: 'boolean', default: field.default as boolean };
		case 'options':
			return {
				...shared,
				type: 'options',
				options: field.options ?? [],
				default: field.default as string,
			};
		case 'json':
			return {
				...shared,
				type: 'json',
				default: field.default as string,
				typeOptions: { rows: 4 },
			};
		case 'stringList':
			return {
				...shared,
				type: 'string',
				default: '',
				placeholder: 'value-one,value-two',
			};
		default:
			return {
				...shared,
				type: 'string',
				default: field.default as string,
				placeholder: action.write ? '' : undefined,
			};
	}
}

export function buildProperties(): INodeProperties[] {
	const properties: INodeProperties[] = [
		{
			displayName: 'Resource',
			name: 'resource',
			type: 'options',
			noDataExpression: true,
			options: RESOURCES,
			default: 'search',
		},
	];

	for (const resource of RESOURCES) {
		const forResource = ACTIONS.filter((action) => action.resource === resource.value);
		properties.push({
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: [resource.value] } },
			options: forResource.map((action) => ({
				name: action.displayName,
				value: action.action,
				description: action.description,
				action: `${action.displayName} — ${resource.name}`,
			})),
			default: forResource[0]?.action ?? '',
		});
	}

	for (const action of ACTIONS) {
		for (const field of action.required) {
			properties.push({
				...baseProperty(field, action),
				displayOptions: { show: displayFor(action) },
			});
		}

		if (action.optional.length > 0) {
			properties.push({
				displayName: 'Additional Fields',
				name: `${action.key}_extra`,
				type: 'collection',
				placeholder: 'Add field',
				default: {},
				displayOptions: { show: displayFor(action) },
				options: action.optional.map((field) => baseProperty(field, action)),
			});
		}
	}

	properties.push({
		displayName: 'Return the Full Envelope',
		name: 'fullEnvelope',
		type: 'boolean',
		default: false,
		description:
			'Whether to output the whole `{id, ok, data}` envelope instead of just `data`. Useful when you want the request id for correlation.',
	});

	return properties;
}

export const NODE_PROPERTIES: INodeProperties[] = buildProperties();

/** Every action, keyed by the value the Operation dropdown stores. */
export const ACTION_BY_NAME: Map<string, ActionSpec> = new Map(
	ACTIONS.map((action) => [action.action, action]),
);
