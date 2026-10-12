import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config for Civic Hub.
 *
 * Expects:
 *   - Backend running on http://localhost:3000 (npm run dev)
 *   - Frontend running on http://localhost:5173 (cd ui && npm run dev)
 *
 * Run with: npm run test:e2e
 *
 * Playwright can auto-start servers via `webServer`, but since Civic Hub
 * requires env vars (.env) and Supabase, it's simpler to start them
 * manually before running tests. The `webServer` blocks below will start
 * them automatically in CI or when they're not already running.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // sequential — shared DB state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    // CIVIC_E2E_BASE_URL: a preview build (`vite preview`, which serves the
    // production security headers); CI uses one (.github/workflows/e2e.yml).
    baseURL: process.env.CIVIC_E2E_BASE_URL?.trim() || "http://localhost:5173",
    // The API's sign-in limits count per client IP (Audit 2). Every browser
    // request reaches it from this machine, so each run claims its own
    // made-up address; locally the API takes X-Forwarded-For as given.
    extraHTTPHeaders: {
      "X-Forwarded-For": `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`,
    },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Uncomment to add more browsers:
    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] },
    // },
    // {
    //   name: "mobile-chrome",
    //   use: { ...devices["Pixel 5"] },
    // },
  ],

  // Started here only when no base URL is given: with CIVIC_E2E_BASE_URL the
  // caller runs the API and the preview itself.
  webServer: process.env.CIVIC_E2E_BASE_URL ? undefined : [
    {
      command: "npm run dev",
      port: 3000,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "cd ui && npm run dev",
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
