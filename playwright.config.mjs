// End-to-end tests for The 1% Planner Hub (tests/README.md).
//   npm run test:e2e          both projects
//   npm run test:e2e:mock     demo mode: pages opened with ?mock=1 (docs/js/mock-api.js in the browser)
//   npm run test:e2e:real     real backend code: pages opened with ?api=http://localhost:<port>/api
// One dev server (backend/dev/server.mjs) serves docs/ for both projects and answers /api for "real".
// Its state lives in memory, so the real project runs in a single worker and every real test uses its
// own fixture account (tests/e2e/helpers/accounts.mjs).
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
const PORT = Number(process.env.E2E_PORT || 8787);
const ORIGIN = `http://localhost:${PORT}`;

// Chromium: the build that matches @playwright/test (installed by `npx playwright install chromium`,
// or preinstalled under PLAYWRIGHT_BROWSERS_PATH). PW_CHROMIUM points at another binary if needed.
const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  outputDir: 'tests/.tmp/results',
  globalSetup: './tests/e2e/global-setup.mjs',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 3 : undefined,
  reporter: [
    [CI ? 'github' : 'list'],
    ['html', { outputFolder: 'tests/.tmp/report', open: 'never' }],
  ],
  use: {
    baseURL: ORIGIN,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 }, // tests set their own viewport where it matters
    locale: 'en-GB',
    timezoneId: 'Asia/Ho_Chi_Minh',
    launchOptions,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'mock',
      use: { hubMode: 'mock' },
      fullyParallel: true,
    },
    {
      name: 'real',
      use: { hubMode: 'real' },
      workers: 1, // one in-memory backend: tests run one after another
      fullyParallel: false,
    },
  ],
  webServer: {
    command: `node backend/dev/server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
