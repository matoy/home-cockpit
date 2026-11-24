import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const hasProductionBuild = fs.existsSync(path.join(process.cwd(), '.next', 'BUILD_ID'));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    locale: 'en-US',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: hasProductionBuild
      ? 'node ./node_modules/next/dist/bin/next start -p 3100 -H 127.0.0.1'
      : 'node ./node_modules/next/dist/bin/next dev -p 3100 -H 127.0.0.1',
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      DATABASE_URL: '',
      APP_PASSWORD: 'e2e-demo-password',
      AUTH_OIDC_ISSUER: '',
      AUTH_OIDC_CLIENT_ID: '',
      AUTH_OIDC_CLIENT_SECRET: '',
    },
  },
});
