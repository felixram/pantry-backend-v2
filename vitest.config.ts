import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    // Report-only, deliberately: the old config had a blanket 70/70/60/70
    // threshold that had been failing silently for a long time before it
    // started actively blocking deploys (see ci.yml's git history) —
    // nobody was ratcheting it, it was just aspirational. Coverage still
    // runs and prints on every CI run (real visibility, not a vanity
    // metric), but doesn't gate merges until there's been enough time to
    // set a threshold against a baseline people actually maintain.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/**/*.test.ts',
        'src/index.ts',
        'src/db/schema/**',
      ],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    // Integration tests (src/__tests__/integration/**) share one real
    // Postgres database and each does beforeEach(() => clearDatabase()) —
    // with vitest's default file-level parallelism, one file's TRUNCATE
    // CASCADE can wipe tables mid-transaction for a test running
    // concurrently in another file (confirmed: this caused real, flaky
    // "Product not found" / "Stock record not found" failures in CI).
    // The full suite runs in ~2s either way, so serializing costs nothing
    // meaningful in exchange for not sharing mutable state across files.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@db': path.resolve(__dirname, './src/db'),
      '@server': path.resolve(__dirname, './src/server'),
    },
  },
});
