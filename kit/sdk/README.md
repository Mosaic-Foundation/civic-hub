# @civic-social/plugin-sdk

What a Civic Hub plugin package imports from the hub (plugin session 2, ADR-015), and the hub's engine as a local test
host for the conformance suite (`@civic-social/plugin-conformance`). The walkthrough is `docs/BUILD-A-PLUGIN.md` in the
hub's repository.

| Import | For |
|---|---|
| `@civic-social/plugin-sdk` | the package's code: the SDK's errors, the package and process contract (types), a type residents draft (`DraftKind`, `Draft`), `emitEvent`, deadlines (`closeThroughDispatcher`, `isPastDeadline`), its own records (`storeSlot`, `readAll`, `HubDbError`), routes (`route`, `requireResident`, `requireAdmin`, `getAuthUser`), small utilities |
| `@civic-social/plugin-sdk/manifest` | its `manifest.ts`, and nothing else: `defineDescriptor`, `defineManifest`, `DEADLINE_CLOSE_INPUT` |
| `@civic-social/plugin-sdk/ui` | its `ui.tsx`: the `ProcessUi` type |
| `@civic-social/plugin-sdk/host`, `/testing` | the conformance suite's, not a package's |

Version 1 of the SDK is narrower than the hub's own (`src/sdk/index.ts`, version 0, which the hub's shipped packages
still import). A name is added when an outside package needs it and Mosaic agrees.

The engine is in `host/` (TypeScript, run through tsx). Its licence is moving to the AGPL (pending; until it is
official, the packed `LICENSE` applies): use it to build and test plugins.
