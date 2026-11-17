// @civic-social/plugin-sdk: the Civic Hub plugin SDK, version 1 (plugin
// session 2, ADR-015). Everything a plugin package written outside this
// repository may import from the hub, by name. A package imports this,
// `@civic-social/plugin-sdk/manifest` (its manifest's helpers), its own files
// and the npm packages its package.json lists as peer dependencies; nothing
// else of the hub.
//
// Narrower than the hub's own SDK (src/sdk/index.ts, version 0), which the
// packages this repository ships still import: version 1 is what a process
// type needs to keep its own records, act on its own processes, emit its own
// events and close at its deadline. A name is added here when an outside
// package needs it and the operator agrees, never by `export *`.
//
// In this repository it re-exports the hub's SDK. As an npm package (see
// ./scripts/pack.ts) it carries the hub's engine beside it as its test host,
// so a developer runs the conformance suite with nothing else of the hub.

// --- Errors: refuse with these, and the hub answers with the right status ----------------
export {
  CivicError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  UnavailableError,
  ValidationError,
} from "../../src/sdk/index.js";

// --- The package and process contract ---------------------------------------------------
export type {
  Process,
  ProcessAction,
  ProcessStatus,
  ProcessHandler,
  FeedProcessMeta,
  PluginPackage,
  PluginServer,
  PluginMount,
  PluginHost,
  PluginAdapters,
  GrantedDb,
  HubQueryBuilder,
  CivicEvent,
  CreateEventInput,
  BriefContent,
  BriefSection,
  JobOutcome,
  JobRunner,
} from "../../src/sdk/index.js";

// --- The one emission path: every event a package writes goes through it ------------------
export { emitEvent } from "../../src/sdk/index.js";

// --- A type residents draft: its kind; the drafts routes, the Code of Conduct gate and the
// review queue are the hub's (docs/PLUGIN-PACKAGE.md, "drafts") --------------------------------
export type { Draft, DraftKind } from "../../src/sdk/index.js";

// --- Deadlines: the hub drives them; a package closes through the hub's action path --------
export { closeThroughDispatcher, isPastDeadline } from "../../src/sdk/index.js";

// --- Work after the action commits (engine 2, A2): writes to its own tables that must not
// happen when the action loses a race or fails, so the action itself stays retry-safe ---------
export { afterActionCommits } from "../../src/sdk/index.js";

// --- Edits of a live process (engine 2, A1): the hub's edit path. A type opts in with its
// handler's editPolicy (who: the creator, or admins too; which of its own state fields), and
// its draft kind's applyLiveEdit hands the edit here, after the hub ran the Code of Conduct
// check on the draft (its `coc` fields included). The hub writes it at the row's version,
// records civic.process.updated with the change, and calls the handler's onEdited. ----------
export { applyEdit } from "../../src/sdk/index.js";
export type { EditPolicy, EditChangeSet } from "../../src/sdk/index.js";

// --- Who did something, as the hub would show it (A3): names under the process's disclosure
// policy (names to members, nothing to the public, per ADR-010), never an account -------------
export { namesFor } from "../../src/sdk/index.js";

// --- Telling people (Events 2, E2): the accounts it names get one message each, by email,
// through the hub's mail guard; the hub holds the addresses and skips whoever unsubscribed ------
export { notify } from "../../src/sdk/index.js";
export type { Notice, NoticeReport } from "../../src/sdk/index.js";

// --- The hub in scope (Events 2, E3): its name, the origin its pages are at, its time zone --------
export { hubContext } from "../../src/sdk/index.js";
export type { HubContext } from "../../src/sdk/index.js";

// --- Its own records, on the database its host hands it (its granted tables only) ----------
export { storeSlot, HubDbError, readAll, readProcessState, writeProcessState } from "../../src/sdk/index.js";
export type { StoreSlot } from "../../src/sdk/index.js";

// --- Routes of its own, when it needs them ---------------------------------------------------
export { route, getAuthUser, requireResident, requireAdmin, resolveCallerId } from "../../src/sdk/index.js";

// --- Small utilities -------------------------------------------------------------------------
export { generateId, str, num } from "../../src/sdk/index.js";
