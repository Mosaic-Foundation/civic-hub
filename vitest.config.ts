import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // API integration tests hit the running dev server via fetch.
    // They do NOT import backend modules directly (which would require
    // Supabase env vars at import time). This keeps test setup simple:
    // start the server, run the tests.
    include: ["tests/api/**/*.test.ts", "tests/unit/**/*.test.ts"],

    // The in-memory adapters, before every file (tests/setup/adapters.ts).
    setupFiles: ["tests/setup/adapters.ts"],

    // Tests run sequentially — they share a dev server and database.
    // fileParallelism: false ensures test files run one at a time,
    // preventing race conditions on shared state (auth tokens, DB).
    fileParallelism: false,
    sequence: { concurrent: false },

    // Give slow CI environments time to complete lifecycle tests.
    testTimeout: 15_000,
  },
});
