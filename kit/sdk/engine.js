// The engine a running hub hands the built SDK (ADR-017). The SDK's .js files
// carry no path into the hub's engine: a package imports the SDK by name, the
// package system resolves it like any other dependency, and the values come
// from the engine the hub installed on globalThis before it loaded any package
// (src/sdk/install.ts, the first import of config/plugins/server.ts).
//
// Hand-written; the other .js files here are generated (`npm run sdk:build`).

const KEY = Symbol.for("@civic-social/plugin-sdk/engine");

/** The hub's SDK, version 0, as the running hub installed it. */
export function engine() {
  const e = globalThis[KEY];
  if (!e) {
    throw new Error(
      "@civic-social/plugin-sdk: no hub engine installed. A package is loaded by the hub's loader " +
        "(config/plugins/server.ts imports src/sdk/install.ts first); it cannot run on its own.",
    );
  }
  return e;
}
