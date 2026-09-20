import { defineConfig, devices } from "@playwright/test";

/**
 * Live-server browser verification against `next dev` on :3000. Not
 * part of `npm test` (vitest) — run explicitly with
 * `npx playwright test` while the dev server is running. Uses the same
 * scripts/.dev-credentials.json accounts as the integration tests; no
 * mocks, real hosted Supabase project.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
