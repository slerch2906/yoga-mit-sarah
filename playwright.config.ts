import { defineConfig, devices } from '@playwright/test'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.test' })

export default defineConfig({
  testDir: './tests/e2e',
  // Nur unsere eigenen Specs (.spec.ts) — verhindert dass Chrome-Extension-
  // Files (Adobe Acrobat hat .spec.js und .test.js) versehentlich mit-geladen
  // werden bei manchen Playwright-Discovery-Modi.
  testMatch: /\.spec\.ts$/,
  fullyParallel: false,      // Tests laufen sequentiell – teilen sich DB-Zustand
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },

  reporter: [
    ['html', { open: 'never' }],
    ['line'],
  ],

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  globalSetup: './tests/fixtures/global-setup.ts',
  globalTeardown: './tests/fixtures/global-teardown.ts',
})
