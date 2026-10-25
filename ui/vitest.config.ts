import { defineConfig } from "vitest/config";

// Component tests (frontend pass, 2026-10-24): beside the code they test,
// in a browser-like DOM. CI runs them in the unit job.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
