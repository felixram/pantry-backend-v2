import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
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
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
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
