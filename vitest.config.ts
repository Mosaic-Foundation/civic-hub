import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const SDK = fileURLToPath(new URL("./kit/sdk/", import.meta.url));

export default defineConfig({
  // The plugin SDK by its npm name, as an outside package and the conformance
  // suite import it (kit/; plugin session 2, ADR-015).
  resolve: {
    alias: [
      { find: /^@civic-social\/plugin-sdk$/, replacement: `${SDK}index.ts` },
      { find: /^@civic-social\/plugin-sdk\/(.+)$/, replacement: `${SDK}$1.ts` },
    ],
  },
  test: {
    // API integration tests hit the running dev server via fetch.
    // They do NOT import backend modules directly (which would require
    // Supabase env vars at import time). This keeps test setup simple:
    // start the server, run the tests.
    include: ["tests/api/**/*.test.ts", "tests/unit/**/*.test.ts"],

    // The in-memory adapters, before every file (tests/setup/adapters.ts).
    setupFiles: ["tests/setup/adapters.ts"],

    // The hubs a run creates are deleted when it ends, pass or fail; local
    // stack only (tests/setup/dropTestHubs.ts).
    globalSetup: ["tests/setup/dropTestHubs.ts"],

    // Tests run sequentially — they share a dev server and database.
    // fileParallelism: false ensures test files run one at a time,
    // preventing race conditions on shared state (auth tokens, DB).
    fileParallelism: false,
    sequence: { concurrent: false },

    // Give slow CI environments time to complete lifecycle tests.
    testTimeout: 15_000,
  },
});
