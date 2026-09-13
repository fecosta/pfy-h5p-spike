import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './specs',
  // The H5P editor is slow to boot (it loads the whole editor client into an
  // iframe), so the default 30s is not enough on a cold library cache.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../apps/h5p-runtime/out/e2e-results.json' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] }, testMatch: /responsive\.spec\.ts/ }
  ],
  webServer: {
    command: 'npx tsx src/server.ts',
    cwd: '../apps/h5p-runtime',
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
