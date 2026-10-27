// The plugin SDK by its npm name, where the server runs compiled.
//
// A package imports `@civic-social/plugin-sdk` by name (ADR-015). Under tsx
// (dev, tests, CI's API and E2E layers) tsconfig's `paths` resolve it to
// kit/sdk. Compiled code has no `paths`: on Vercel the function carries
// kit/sdk compiled beside src/ (the root package.json's file dependency is
// what makes Vercel trace it) but not the node_modules link to it, and in
// `npm run build`'s dist/ the link points at the uncompiled sources. Without
// this the function failed to start on dev (2026-10-27, the Events plugin).
//
// So: when kit/sdk/<entry>.js sits beside this file's directory, the name
// resolves there, and the SDK and the engine it re-exports are the same
// compiled modules. Otherwise (tsx, where only .ts exists) resolution goes on
// as before. Imported before anything that loads a package: api/index.ts and
// src/index.ts import the app only after it.

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NAME = "@civic-social/plugin-sdk";
const compiledSdk = new URL("../kit/sdk/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === NAME || specifier.startsWith(`${NAME}/`)) {
      const entry = specifier === NAME ? "index" : specifier.slice(NAME.length + 1);
      const url = new URL(`${entry}.js`, compiledSdk);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
