// The plugin SDK, version 0: everything a plugin package may import from the
// hub's engine, by name (plugin session 1, ADR-014; ADR-012's "what a plugin
// may import" made exact). A package imports this file, src/shared/ (plain
// data), its own files and the packages its `requires` names; nothing else
// of the hub (eslint `civic/package-boundary`). Its manifest imports only
// src/processes/manifest.ts and src/shared/, because the UI reads it too.
//
// Version 0 is what the nine packages the hub ships with use today, so it is
// wide. Plugin session 2 narrows it and publishes it as its own package. What
// is NOT here is the point: no database client (a package's store gets
// host.db(), its granted tables only), no adapter (host.adapter(), its granted
// ones only), no hosting layer, no console.
//
// Adding a name: export it here, explicitly (never `export *`), and say in
// the package's change why it needs it.

// --- Errors (src/errors/) ------------------------------------------------------
export {
  CivicError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  UnavailableError,
  ValidationError,
} from "../errors/index.js";

// --- The process contract ------------------------------------------------------------
export type { Process, ProcessAction, ProcessStatus } from "../models/process.js";
export type { ProcessHandler } from "../processes/types.js";
export type { FeedProcessMeta } from "../processes/contracts/feedMeta.js";
export { storeSlot, type StoreSlot } from "../processes/storeSlot.js";
export type { GrantedDb, PluginHost, PluginPackage, PluginServer, PluginMount } from "../plugins/package.js";

// --- Events: the one emission path ---------------------------------------------------
export { emitEvent } from "../events/eventEmitter.js";

// --- The hub's services a package calls ----------------------------------------------
export { getProcess } from "../services/processService.js";
export { readProcessState, writeProcessState } from "../services/processRows.js";

// --- Requests ------------------------------------------------------------------------
export { route } from "../http/route.js";
export { resolveCallerId } from "../middleware/auth.js";

// --- Storage helpers (over host.db()) ---------------------------------------------------
export { HubDbError } from "../db/forHub.js";
export type { HubQueryBuilder } from "../db/forHub.js";
export { readAll } from "../db/readAll.js";

// --- Small utilities ----------------------------------------------------------------
export { generateId } from "../utils/id.js";
export { str, num } from "../utils/readField.js";
