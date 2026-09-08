/**
 * OpenAPI 3.1, generated from `contract.ts` so it can never drift from the
 * actions the server actually serves. `npm run gen` writes it to
 * `openapi.json`, alongside `tools.json`; the Node and Python clients and the
 * docs are generated from those two files.
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import {
  ACTIONS,
  CampaignSchema,
  CompanySchema,
  ConfigSchema,
  EngagerSchema,
  ERROR_CODES,
  ListMemberSchema,
  ListSchema,
  MessageSchema,
  PackSchema,
  PARAMS,
  ProfileSchema,
  QueueItemSchema,
  RateLimitSchema,
  ResearchRowSchema,
  ResolvedRowSchema,
  RESULTS,
  StatusSchema,
  StepSchema,
  ThreadSchema,
  TOOLS,
  WriteResultSchema,
  isWriteAction,
  toolInputSchema,
  type ActionName,
} from './contract.js';

export const OPENAPI_VERSION = '3.1.0';
export const API_VERSION = '2.0.0';

type JsonSchema = Record<string, unknown>;

/**
 * A fully inlined, self-contained JSON schema — what `tools.json` needs, since
 * each tool definition is handed to an agent framework on its own.
 *
 * The one recursive type, a campaign `Step` whose `branch` contains further
 * steps, cannot be expressed inline, so nested branch steps degrade to "any"
 * here; zod still validates them completely at runtime, and the OpenAPI
 * document expresses them properly through `#/components/schemas/Step`.
 * zod-to-json-schema warns about the recursion on every call, which would
 * drown the server log, so the warning is muted.
 */
export function jsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const generated = zodToJsonSchema(schema, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    }) as JsonSchema;
    delete generated.$schema;
    return generated;
  } finally {
    console.warn = warn;
  }
}

/** Machine-readable tool definitions: the input for the client packages. */
export function toolsJson(): {
  version: string;
  tools: { name: string; action: string | null; description: string; write: boolean; inputSchema: JsonSchema }[];
} {
  return {
    version: API_VERSION,
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      action: tool.action,
      description: tool.description,
      write: tool.write,
      inputSchema: jsonSchema(toolInputSchema(tool)),
    })),
  };
}

/**
 * The shared types, emitted once into `components/schemas` and referenced from
 * every path. This is also how the recursive `Step` type is expressed properly
 * rather than degrading to "any".
 */
const DEFINITIONS = {
  Profile: ProfileSchema,
  Company: CompanySchema,
  Engager: EngagerSchema,
  Thread: ThreadSchema,
  Message: MessageSchema,
  List: ListSchema,
  ListMember: ListMemberSchema,
  Step: StepSchema,
  Campaign: CampaignSchema,
  QueueItem: QueueItemSchema,
  ResearchRow: ResearchRowSchema,
  ResolvedRow: ResolvedRowSchema,
  Pack: PackSchema,
  WriteResult: WriteResultSchema,
  RateLimit: RateLimitSchema,
  Status: StatusSchema,
  Config: ConfigSchema,
};

const DEFINITION_PATH = 'components/schemas';

/** Like `jsonSchema`, but referencing the shared component schemas. */
function refSchema(schema: z.ZodTypeAny): JsonSchema {
  const generated = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'root',
    definitions: DEFINITIONS,
    definitionPath: DEFINITION_PATH,
  }) as JsonSchema;
  delete generated.$schema;
  delete generated[DEFINITION_PATH];
  return generated;
}

function componentSchemas(): JsonSchema {
  const generated = zodToJsonSchema(z.object({}), {
    target: 'jsonSchema7',
    $refStrategy: 'root',
    definitions: DEFINITIONS,
    definitionPath: DEFINITION_PATH,
  }) as JsonSchema;
  return (generated[DEFINITION_PATH] ?? {}) as JsonSchema;
}

function envelopeSchema(action: ActionName): JsonSchema {
  return {
    oneOf: [
      {
        type: 'object',
        required: ['id', 'ok', 'data'],
        properties: {
          id: { type: 'string' },
          ok: { const: true },
          data: refSchema(RESULTS[action]),
          rateLimit: { $ref: '#/components/schemas/RateLimit' },
        },
      },
      { $ref: '#/components/schemas/ErrorEnvelope' },
    ],
  };
}

export function buildOpenApi(): JsonSchema {
  const paths: Record<string, unknown> = {};

  for (const action of ACTIONS) {
    const write = isWriteAction(action);
    paths[`/actions/${action}`] = {
      post: {
        operationId: `action_${action.replace('.', '_')}`,
        summary: action,
        description: `Run the \`${action}\` action on the connected extension.${
          write ? ' This is a write action: it is rate-capped and queues for approval in Copilot mode.' : ''
        }`,
        tags: [action.split('.')[0]],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: refSchema(PARAMS[action]) } },
        },
        responses: {
          '200': {
            description: 'Action envelope.',
            content: { 'application/json': { schema: envelopeSchema(action) } },
          },
          '401': {
            description: 'Missing or wrong bearer token.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
            },
          },
        },
      },
    };
  }

  for (const tool of TOOLS) {
    paths[`/tools/${tool.name}`] = {
      post: {
        operationId: `tool_${tool.name}`,
        summary: tool.name,
        description: tool.description,
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: refSchema(toolInputSchema(tool)) } },
        },
        responses: {
          '200': {
            description: 'Tool envelope.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Envelope' } },
            },
          },
        },
      },
    };
  }

  paths['/health'] = {
    get: {
      operationId: 'health',
      summary: 'Liveness and extension connection state. No authentication.',
      tags: ['server'],
      security: [],
      responses: {
        '200': {
          description: 'Server health.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ok', 'extensionConnected', 'version'],
                properties: {
                  ok: { type: 'boolean' },
                  extensionConnected: { type: 'boolean' },
                  version: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  };

  paths['/openapi.json'] = {
    get: {
      operationId: 'openapi',
      summary: 'This document.',
      tags: ['server'],
      security: [],
      responses: { '200': { description: 'OpenAPI 3.1 document.' } },
    },
  };

  paths['/mcp'] = {
    post: {
      operationId: 'mcp',
      summary: 'Model Context Protocol over Streamable HTTP.',
      description:
        'JSON-RPC 2.0 MCP messages. Point an MCP client at this URL with the pairing token as a bearer token.',
      tags: ['server'],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      responses: { '200': { description: 'MCP response or SSE stream.' } },
    },
  };

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'LinkedIn Toolkit',
      version: API_VERSION,
      description:
        'Local HTTP API for the LinkedIn Toolkit. The server runs on the user\'s own machine and ' +
        'drives their own logged-in Chrome through the toolkit extension; nothing is hosted and no ' +
        'credentials are stored. Every write is rate-capped by the extension and queues for human ' +
        'approval in Copilot mode.',
      license: { name: 'MIT' },
    },
    servers: [{ url: 'http://127.0.0.1:47830', description: 'lit serve --http' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'The pairing token from ~/.linkedin-toolkit/config.json.',
        },
      },
      schemas: {
        ...componentSchemas(),
        Error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', enum: [...ERROR_CODES] },
            message: { type: 'string' },
            retryAfter: { type: 'number' },
            howToFix: { type: 'string' },
          },
        },
        ErrorEnvelope: {
          type: 'object',
          required: ['id', 'ok', 'error'],
          properties: {
            id: { type: 'string' },
            ok: { const: false },
            error: { $ref: '#/components/schemas/Error' },
          },
        },
        Envelope: {
          oneOf: [
            {
              type: 'object',
              required: ['id', 'ok', 'data'],
              properties: {
                id: { type: 'string' },
                ok: { const: true },
                data: {},
                rateLimit: { $ref: '#/components/schemas/RateLimit' },
              },
            },
            { $ref: '#/components/schemas/ErrorEnvelope' },
          ],
        },
      },
    },
    paths,
  };
}

let cached: JsonSchema | null = null;

export function openApiDocument(): JsonSchema {
  cached ??= buildOpenApi();
  return cached;
}
