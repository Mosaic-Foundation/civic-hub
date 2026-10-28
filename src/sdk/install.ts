// The engine handed to the built plugin SDK (ADR-017).
//
// `@civic-social/plugin-sdk`'s compiled files carry no path into this engine:
// they read the names a package imports from what this module puts on
// globalThis. It is the first import of config/plugins/server.ts (written by
// `npm run plugins:sync`), so it runs before any package's module does, on
// every server: Vercel's function, `npm start`'s dist/, run-anywhere, tsx.
// Under tsx the SDK's .ts sources re-export the engine directly and this is
// unused but harmless.

import * as sdk from "./index.js";

const KEY = Symbol.for("@civic-social/plugin-sdk/engine");
(globalThis as Record<symbol, unknown>)[KEY] = sdk;
