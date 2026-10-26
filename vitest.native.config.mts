import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['test/native/**/*.test.ts'], environment: 'node',
  testTimeout: 30000, hookTimeout: 10000, fileParallelism: false,
} });
