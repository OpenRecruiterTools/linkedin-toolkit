import { describe, expect, it } from 'vitest';
import type { INodeProperties } from 'n8n-workflow';

import { ACTIONS, RESOURCES } from '../nodes/LinkedInToolkit/actions.generated';
import { LinkedInToolkit } from '../nodes/LinkedInToolkit/LinkedInToolkit.node';
import { ACTION_BY_NAME, NODE_PROPERTIES } from '../nodes/LinkedInToolkit/properties';
import { LinkedInToolkitApi } from '../credentials/LinkedInToolkitApi.credentials';

const node = new LinkedInToolkit();

const byName = (name: string): INodeProperties[] =>
  NODE_PROPERTIES.filter((property) => property.name === name);

describe('the node description', () => {
  it('declares the credential, one main input and one main output', () => {
    expect(node.description.credentials).toEqual([{ name: 'linkedInToolkitApi', required: true }]);
    expect(node.description.inputs).toEqual(['main']);
    expect(node.description.outputs).toEqual(['main']);
    expect(node.description.name).toBe('linkedInToolkit');
  });

  it('offers every namespace as a resource', () => {
    const resource = byName('resource')[0];
    const values = (resource.options as Array<{ value: string }>).map((option) => option.value);
    expect(values).toEqual(RESOURCES.map((r) => r.value));
    expect(values).toContain('search');
    expect(values).toContain('outreach');
    expect(values).toContain('research');
  });

  it('offers every action as an operation of its resource, and nothing else', () => {
    const operations = byName('operation');
    expect(operations).toHaveLength(RESOURCES.length);

    const offered = operations.flatMap((property) =>
      (property.options as Array<{ value: string }>).map((option) => option.value),
    );
    expect(offered.sort()).toEqual(ACTIONS.map((a) => a.action).sort());

    for (const property of operations) {
      const resource = (property.displayOptions?.show?.resource as string[])[0];
      for (const option of property.options as Array<{ value: string }>) {
        expect(ACTION_BY_NAME.get(option.value)?.resource).toBe(resource);
      }
    }
  });
});

describe('field properties', () => {
  it('gives every parameter a unique name, so two operations cannot share a value', () => {
    const names = NODE_PROPERTIES.map((property) => property.name);
    expect(new Set(names).size + (names.length - new Set(names).size)).toBe(names.length);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index && name !== 'operation');
    expect(duplicates).toEqual([]);
  });

  it('shows a required field only for its own operation', () => {
    const keywords = byName('search_people_keywords')[0];
    expect(keywords.required).toBe(true);
    expect(keywords.displayOptions?.show).toEqual({
      resource: ['search'],
      operation: ['search.people'],
    });
  });

  it('puts optional fields, including dry_run, in one Additional Fields collection', () => {
    const collection = byName('outreach_invite_extra')[0];
    expect(collection.type).toBe('collection');
    const options = (collection.options as INodeProperties[]).map((option) => option.name);
    expect(options).toContain('outreach_invite_note');
    expect(options).toContain('outreach_invite_dry_run');
  });

  it('never offers dry_run on a read action', () => {
    for (const action of ACTIONS) {
      if (action.write) continue;
      const fields = [...action.required, ...action.optional].map((field) => field.key);
      expect(fields, action.action).not.toContain('dry_run');
    }
  });

  it('turns an enum into an options dropdown with the contract values', () => {
    const collection = byName('search_people_extra')[0];
    const source = (collection.options as INodeProperties[]).find(
      (option) => option.name === 'search_people_source',
    )!;
    expect(source.type).toBe('options');
    expect((source.options as Array<{ value: string }>).map((o) => o.value)).toEqual([
      'search',
      'salesnav',
      'recruiter',
    ]);
  });

  it('exposes an array of strings as a comma-separated field and an array of objects as JSON', () => {
    const publicIds = byName('network_status_publicIds')[0];
    expect(publicIds.type).toBe('string');
    expect(publicIds.placeholder).toBe('value-one,value-two');

    const steps = byName('campaign_create_steps')[0];
    expect(steps.type).toBe('json');
    expect(steps.default).toBe('[]');
  });

  it('every field a property exists for is one the action actually accepts', () => {
    for (const action of ACTIONS) {
      for (const field of action.required) {
        expect(byName(field.name), `${action.action} ${field.name}`).toHaveLength(1);
      }
      if (action.optional.length > 0) {
        expect(byName(`${action.key}_extra`), action.action).toHaveLength(1);
      }
    }
  });
});

describe('the credential', () => {
  const credential = new LinkedInToolkitApi();

  it('takes a base URL and a token, and sends the token as a bearer header', () => {
    expect(credential.name).toBe('linkedInToolkitApi');
    expect(credential.properties.map((property) => property.name)).toEqual(['baseUrl', 'token']);
    expect(credential.properties[0].default).toBe('http://127.0.0.1:47830');
    expect(credential.properties[1].typeOptions?.password).toBe(true);
    expect(credential.authenticate).toEqual({
      type: 'generic',
      properties: { headers: { Authorization: '=Bearer {{$credentials.token}}' } },
    });
  });

  it('tests against /health, which needs no token', () => {
    expect(credential.test.request.url).toBe('/health');
    expect(credential.test.request.method).toBe('GET');
  });
});
