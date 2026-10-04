import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/ffmpeg/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 10_000,
    maxWorkers: 1,
  },
});
