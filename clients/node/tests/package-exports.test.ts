import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');

describe('built package exports', () => {
  it('loads the public API through CommonJS', () => {
    const require = createRequire(import.meta.url);
    const packageApi = require(resolve(dist, 'index.cjs')) as Record<string, unknown>;

    expect(packageApi.LinkedInToolkit).toBeTypeOf('function');
  });

  it('loads the public API through ESM', async () => {
    const packageApi = (await import(pathToFileURL(resolve(dist, 'index.js')).href)) as Record<
      string,
      unknown
    >;

    expect(packageApi.LinkedInToolkit).toBeTypeOf('function');
  });
});
