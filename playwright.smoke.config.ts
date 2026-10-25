import { defineConfig, devices } from "@playwright/test";

/**
 * The dev smoke suite (tests/smoke), against the LIVE dev deployment: no web
 * server is started. Run by .github/workflows/smoke.yml after each dev deploy,
 * or by hand with the CIVIC_SMOKE_* variables set (tests/smoke/devStack.ts):
 *
 *   npm run test:smoke
 *
 * One worker, in file order, and no retries: a few steps act on what an
 * earlier one made, and a retry would submit (and spend Code of Conduct
 * checks on) everything again. Every check runs even after a failure (the
 * spec is not serial; its header says how state and cleanup survive one).
 * The whole run must stay under three minutes; the global timeout enforces it.
 */
export default defineConfig({
  testDir: "./tests/smoke",
  testMatch: /.*\.smoke\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  globalTimeout: 170_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",

  use: {
    baseURL: process.env.CIVIC_SMOKE_BASE_URL?.trim().replace(/\/$/, ""),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
