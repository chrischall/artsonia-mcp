import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The Worker connector suite runs under the Cloudflare Workers pool
    // (`vitest.workers.config.ts` / `npm run worker:test`), NOT the Node pool —
    // it imports `cloudflare:test`, which can't load under Node.
    exclude: ['tests/worker.test.ts', 'node_modules/**'],
    coverage: {
      // src/worker.ts is the Cloudflare Worker entry point — it imports
      // `agents`/`cloudflare:workers` and is only exercised by the Workers-pool
      // suite, so it's excluded from the Node-pool coverage gate.
      exclude: ['src/worker.ts'],
    },
  },
});
