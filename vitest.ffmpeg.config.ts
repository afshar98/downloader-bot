import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/ffmpeg/**/*.test.ts'],
    exclude: configDefaults.exclude,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxWorkers: 1,
    fileParallelism: false,
    env: { TZ: 'UTC' },
  },
});
