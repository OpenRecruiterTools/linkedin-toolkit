#!/usr/bin/env node
/**
 * `npm run gen` — write `openapi.json` and `tools.json` next to the package so
 * the client packages, the n8n node and the docs can be generated from them.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildOpenApi, toolsJson } from './openapi.js';

export function generate(outDir: string): { openapi: string; tools: string } {
  const openapiPath = join(outDir, 'openapi.json');
  const toolsPath = join(outDir, 'tools.json');
  writeFileSync(openapiPath, `${JSON.stringify(buildOpenApi(), null, 2)}\n`, 'utf8');
  writeFileSync(toolsPath, `${JSON.stringify(toolsJson(), null, 2)}\n`, 'utf8');
  return { openapi: openapiPath, tools: toolsPath };
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[1] && process.argv[1].endsWith('gen.js')) {
  const written = generate(packageRoot);
  process.stdout.write(`wrote ${written.openapi}\nwrote ${written.tools}\n`);
}
