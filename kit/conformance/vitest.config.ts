// The suite's own run, as `civic-conformance` starts it: one file, one test
// at a time (they share the test host and its database), the hub's engine
// (TypeScript, in node_modules/@civic-social/plugin-sdk) transformed rather
// than loaded as it is.

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["src/conformance.test.ts"],
    setupFiles: ["src/setup.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    server: { deps: { inline: [/@civic-social\//] } },
  },
});
