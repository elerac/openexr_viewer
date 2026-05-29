import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const previewCommand = 'npm run preview -- --host 127.0.0.1 --port 4173';
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
  (process.env.PLAYWRIGHT_PREBUILT === 'true'
    ? previewCommand
    : `npm run build:e2e && ${previewCommand}`);

function resolveWorkerCount(): number | undefined {
  const rawValue = process.env.PLAYWRIGHT_WORKERS;
  if (!rawValue) {
    return isCI ? 1 : undefined;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`PLAYWRIGHT_WORKERS must be a positive integer. Received: ${rawValue}`);
  }

  return value;
}

export default defineConfig({
  testDir: './e2e',
  timeout: isCI ? 90000 : 30000,
  retries: 0,
  workers: resolveWorkerCount(),
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT ?? 'test-results/playwright-results.json' }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    },
    screenshot: 'only-on-failure',
    trace: isCI ? 'retain-on-failure' : 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: webServerCommand,
    port: 4173,
    timeout: 120000,
    reuseExistingServer: !isCI
  }
});
