import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default defineConfig({
  define: baseConfig.define,
  resolve: baseConfig.resolve,
  test: {
    include: ['tests/runtime/*.runtime.ts'],
    fileParallelism: false,
    hookTimeout: 90_000,
    testTimeout: 45_000,
  },
});
