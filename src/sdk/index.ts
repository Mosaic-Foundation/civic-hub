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

// --- Requests and the names a package uses as it loads ----------------------------------
// Listed ahead of the groups that reach the loader (the events and services
// below): a package's routes call route() and take requireResident, and its
// handler reads KEYS, when the package loads, and the loader loads every
// package while this file is still being evaluated if a package's own file was
// the first thing imported.
export { route } from "../http/route.js";
export {
  resolveCallerId,
  getAuthUser,
  requireResident,
  resolveCallerUser,
  requireOfficial,
} from "../middleware/auth.js";
export { KEYS } from "../models/hubSettings.js";

// --- Events: the one emission path ---------------------------------------------------
export { emitEvent, buildEvent } from "../events/eventEmitter.js";

// --- The hub's services a package calls ----------------------------------------------
export {
  getProcess,
  getSampleProcessIds,
  getAllProcesses,
  saveProcessState,
} from "../services/processService.js";
export { readProcessState, writeProcessState, publishedBriefRows } from "../services/processRows.js";

// --- Storage helpers (over host.db()) ---------------------------------------------------
export { HubDbError } from "../db/forHub.js";
export type { HubQueryBuilder } from "../db/forHub.js";
export { readAll } from "../db/readAll.js";

// --- Small utilities ----------------------------------------------------------------
export { generateId } from "../utils/id.js";
export { str, num } from "../utils/readField.js";

// --- The vote's ballots and receipts (src/modules/civic.receipts/) -----------------------
export {
  claimVoteKey,
  getVoteLog,
  verifyReceipt,
  recordOrUpdateVote,
  clearActiveVoteKeysForProcess,
  countVoters,
  getBallotChoicesForProcess,
  hasUserVoted,
  reshuffleBallotsForProcess,
  VoteRefusedError,
} from "../modules/civic.receipts/index.js";
export type { HeldReceipt } from "../modules/civic.receipts/index.js";

// --- Drafts and the drafting assistant (src/modules/civic.drafts/, civic.assistant/) ----
export type { AssistantTypeConfig, DraftField } from "../modules/civic.assistant/index.js";
export {
  getDraft,
  appendConversation,
  saveReviewResult,
  applyGeneratedDraft,
  updateDraft,
  setDraftStatus,
  createDraft,
} from "../modules/civic.drafts/index.js";
export type { Draft, ProposedLink } from "../modules/civic.drafts/index.js";
export { DAY_MS, lines } from "../processes/draftKinds.js";
export type { DraftKind } from "../processes/draftKinds.js";

// --- Resident input on a process (src/modules/civic.input/) -----------------------------
export { getInputsByProcess, listVisibleInPhase, countVisibleOutsidePhase } from "../modules/civic.input/index.js";

// --- Events (src/models/event.ts) ------------------------------------------------------
export type { CivicEvent, CreateEventInput } from "../models/event.js";

// --- Settings the hub keeps (src/services/hubSettings.ts) ------------------------------
export {
  voteDurationLimitsSync,
  getSupportThreshold,
  defaultCheckModeSync,
  getSettingSync,
  getVoteResultsRecipients,
  hubDisplayNameSync,
} from "../services/hubSettings.js";

// --- The hub in scope (src/config/hubContext.ts) ---------------------------------------
export { currentHubId } from "../config/hubContext.js";

// --- Acting on a process ---------------------------------------------------------------
export { closeThroughDispatcher } from "../processes/serviceSlots.js";
export { afterActionCommits } from "../services/actionScope.js";
export { isPastDeadline } from "../utils/deadline.js";
export { AlreadyVotedError } from "../db/atomic.js";

// --- Brief content a process hands its brief (src/processes/contracts/briefContent.ts) ---
export type { BriefContent, BriefSection } from "../processes/contracts/briefContent.js";

// --- Reporting (src/utils/reportError.ts) ----------------------------------------------
export { reportError } from "../utils/reportError.js";

// --- src/services/creatorDisplay.ts ------------------------------------------------------
export { enrichCreator, enrichCreators } from "../services/creatorDisplay.js";

// --- src/controllers/processController.ts ------------------------------------------------
export { actOnProcess, readAsPage, viewFor } from "../controllers/processController.js";

// --- src/config/hub.ts -------------------------------------------------------------------
export { defaultJurisdiction } from "../config/hub.js";

// --- src/modules/civic.process_links/ ----------------------------------------------------
export { validateLinkSet } from "../modules/civic.process_links/index.js";

// --- Edits of a live process (src/services/processEdits.ts) ------------------------------
// Loaded on the first call, not with the SDK: the process handlers import their
// draft kinds while the registry loads, and processEdits imports the process service.
import type { applyEdit as applyEditNow } from "../services/processEdits.js";
export const applyEdit: typeof applyEditNow = async (...args) => (await import("../services/processEdits.js")).applyEdit(...args);

// --- src/services/sampleContent.ts -------------------------------------------------------
export { sampleDeliverySuppressed } from "../services/sampleContent.js";

// --- src/utils/baseUrl.ts ----------------------------------------------------------------
export { uiBaseUrl } from "../utils/baseUrl.js";

// --- src/modules/civic.link_preview/ -----------------------------------------------------
export { extractUrls } from "../modules/civic.link_preview/index.js";

// --- src/services/linkPreviewCache.ts ----------------------------------------------------
export { warmPreviewsInBackground } from "../services/linkPreviewCache.js";

// --- src/services/briefRegenerate.ts -----------------------------------------------------
export {
  applyOnApproval,
  discardBriefRevision,
  publishBriefRevision,
  regenerateBrief,
} from "../services/briefRegenerate.js";

// --- src/services/briefFinalize.ts -------------------------------------------------------
export { finalizeBriefSource } from "../services/briefFinalize.js";

// --- src/services/processLinks.ts --------------------------------------------------------
export { processWireIris } from "../services/processLinks.js";

// --- src/services/processLinkCounts.ts ---------------------------------------------------
export { countLinksTouching } from "../services/processLinkCounts.js";

// --- src/services/briefResponses.ts ------------------------------------------------------
export {
  insertResponse,
  latestAnchorAt,
  listResponsesForBrief,
  responderNames,
} from "../services/briefResponses.js";
