/**
 * A minimal stand-in for n8n's execution context.
 *
 * Enough of `IExecuteFunctions` for `execute()` to run: parameters, credentials
 * and a recording HTTP helper. The point of these tests is the mapping from
 * panel parameters to the request body, so the HTTP call is stubbed and every
 * request it would have made is kept.
 */
import type { IDataObject } from 'n8n-workflow';

export type RecordedRequest = {
  method: string;
  url: string;
  body: IDataObject;
  credentialType: string;
};

export type ContextOptions = {
  parameters: Record<string, unknown>;
  response?: unknown | ((request: RecordedRequest) => unknown);
  items?: number;
  credentials?: IDataObject;
  continueOnFail?: boolean;
};

export function makeContext(options: ContextOptions) {
  const requests: RecordedRequest[] = [];
  const credentials = options.credentials ?? {
    baseUrl: 'http://127.0.0.1:47830',
    token: 'test-token',
  };

  const context = {
    requests,
    getInputData: () => Array.from({ length: options.items ?? 1 }, () => ({ json: {} })),
    getCredentials: async () => credentials,
    getNode: () => ({ name: 'LinkedIn Toolkit', type: 'linkedInToolkit', typeVersion: 1 }),
    continueOnFail: () => options.continueOnFail ?? false,
    getNodeParameter: (name: string, _index?: number, fallback?: unknown) =>
      name in options.parameters ? options.parameters[name] : fallback,
    helpers: {
      httpRequestWithAuthentication: async function (
        this: unknown,
        credentialType: string,
        request: { method: string; url: string; body: IDataObject },
      ) {
        const recorded: RecordedRequest = {
          method: request.method,
          url: request.url,
          body: request.body,
          credentialType,
        };
        requests.push(recorded);
        const reply = options.response ?? { id: 'req_1', ok: true, data: {} };
        return typeof reply === 'function'
          ? (reply as (r: RecordedRequest) => unknown)(recorded)
          : reply;
      },
      returnJsonArray: (data: IDataObject[]) => data.map((json) => ({ json })),
    },
  };

  return context;
}

/** A stand-in for `IWebhookFunctions`. */
export function makeWebhookContext(body: unknown, parameters: Record<string, unknown> = {}) {
  return {
    getBodyData: () => body,
    getNodeParameter: (name: string, fallback?: unknown) =>
      name in parameters ? parameters[name] : fallback,
    helpers: {
      returnJsonArray: (data: IDataObject[]) => data.map((json) => ({ json })),
    },
  };
}
