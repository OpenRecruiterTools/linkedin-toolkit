import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const built = existsSync(resolve(dist, 'index.cjs')) && existsSync(resolve(dist, 'index.js'));

// These tests read the built package. Run `npm run build -w clients/node` first; CI builds before testing.
describe.skipIf(!built)('built package exports', () => {
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

  // The workspace symlinks `linkedin-toolkit` into the root node_modules, so resolving by
  // package name exercises the real exports map — the thing issue #16 was about.
  it('resolves require("linkedin-toolkit") through the exports map to the CommonJS build', () => {
    const require = createRequire(import.meta.url);
    expect(require.resolve('linkedin-toolkit')).toMatch(/index\.cjs$/);
    const packageApi = require('linkedin-toolkit') as Record<string, unknown>;
    expect(packageApi.LinkedInToolkit).toBeTypeOf('function');
  });

  it('declares CommonJS types next to the CommonJS entry', async () => {
    const pkg = (await import(pathToFileURL(resolve(here, '..', 'package.json')).href, {
      with: { type: 'json' },
    })) as { default: { exports: Record<string, { require: { types: string }; import: { types: string } }> } };
    const root = pkg.default.exports['.'];
    expect(root.require.types).toBe('./dist/index.d.cts');
    expect(root.import.types).toBe('./dist/index.d.ts');
    expect(existsSync(resolve(dist, 'index.d.cts'))).toBe(true);
  });
});
