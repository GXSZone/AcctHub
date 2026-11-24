import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'playwright-report/results.json' }]],
  globalSetup: './scripts/browser-environment.mjs',
  use: {
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 允许本地开发通过 PLAYWRIGHT_CHANNEL=chrome|msedge 直接复用本机浏览器
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
});
