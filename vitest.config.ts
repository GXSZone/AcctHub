import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __ACCTHUB_SANDBOX__: true },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@web': fileURLToPath(new URL('./src', import.meta.url)),
      '@worker': fileURLToPath(new URL('./worker', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Windows 本地运行大量内存隔离测试时默认 CPU 核并发易触发 V8 堆 OOM，限制 2 进程保障稳定；Linux/CI 维持满速并发
    ...(process.platform === 'win32' && !process.env.CI ? { maxWorkers: 2 } : {}),
    include: ['shared/**/*.test.ts', 'worker/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.wrangler'],
  },
});
