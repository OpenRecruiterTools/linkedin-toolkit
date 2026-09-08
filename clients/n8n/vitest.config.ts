import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});

// A note on the noise: n8n-workflow publishes source maps that point at sources
// it does not ship, so vite-node prints one "Sourcemap ... points to missing
// source files" line per file it loads from that package. It is upstream, it is
// harmless, and the alternatives (externalising the package, whose ESM build has
// extensionless internal imports) break the run outright.
