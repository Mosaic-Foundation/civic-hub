// @civic-social/plugin-sdk/first-party: the hub's own SDK, version 0
// (src/sdk/index.ts), by name, for the packages this repository ships
// (ADR-017). Wide, as version 0 always was; lint keeps it to packages/ in this
// repository, and it is never packed for an outside developer, who imports
// version 1 (`@civic-social/plugin-sdk`). Every name is listed one by one in
// src/sdk/index.ts; this re-exports exactly that list.
//
// Under tsx (dev, tests) this file runs; compiled, the generated first-party.js
// reads the same names from the engine the hub installed (./engine.js).

export * from "../../src/sdk/index.js";
