import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 5199);
const command = process.env.E2E_PREVIEW
  ? `npx vite preview --port ${port} --strictPort`
  : `npx vite --port ${port} --strictPort`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  fullyParallel: true,
  workers: 6,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command, port, reuseExistingServer: true, timeout: 30_000, env: { E2E: '1' } },
  projects: [
    {
      name: 'main',
      testIgnore: /perf\.spec\.ts/,
    },
    {
      name: 'perf',
      testMatch: /perf\.spec\.ts/,
      dependencies: ['main'],
      workers: 1,
    },
  ],
});
