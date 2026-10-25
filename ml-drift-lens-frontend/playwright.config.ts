import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node ../ml-drift-lens-backend/tests/helpers/authE2eServer.js',
      url: 'http://127.0.0.1:3019/',
      reuseExistingServer: false,
      timeout: 20000,
      env: {
        DB_NAME: 'ml_drift_lens_auth_phase4_test_20261025',
        DB_PASSWORD: process.env.DB_PASSWORD || 'root',
        DB_PORT: process.env.DB_PORT || '5432',
        PORT: '3019',
        NODE_ENV: 'test',
        SESSION_SECRET: 'isolated-e2e-playwright-test-secret-at-least-32-chars',
        SESSION_COOKIE_SECURE: 'false',
        CORS_ORIGINS: 'http://localhost:5199,http://127.0.0.1:5199,http://localhost:5180,http://127.0.0.1:5180',
      },
    },
    {
      command: 'npx vite --port 5199 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:5199',
      reuseExistingServer: false,
      timeout: 20000,
      env: {
        VITE_API_PROXY_TARGET: 'http://127.0.0.1:3019',
      },
    },
  ],
});
