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
export type { Process, ProcessAction, ProcessStatus, CreateProcessInput } from "../models/process.js";
export type { ProcessHandler, RegeneratedBrief, EditPolicy, EditChangeSet } from "../processes/types.js";
export type { FeedProcessMeta } from "../processes/contracts/feedMeta.js";
export { storeSlot, type StoreSlot } from "../processes/storeSlot.js";
export type { GrantedDb, PluginAdapters, PluginHost, PluginPackage, PluginServer, PluginMount, ClosedProcess } from "../plugins/package.js";
export type { PluginSamples, PluginSampleTemplate, SampleKit, SampleTemplate, SampleRow, SampleRefreshWindow } from "../plugins/samples.js";

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
  resolveCallerIsAdmin,
  requireBoardOrAdmin,
  requireAdmin,
  requireAuthor,
  authorshipOf,
  type AuthorOf,
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
  createProcess,
  archiveProcess,
  getArchivedProcesses,
} from "../services/processService.js";
export { readProcessState, writeProcessState } from "../services/processRows.js";
export { processesOf } from "../services/ownProcesses.js";
export { warmPreviewsInBackground as warmLinkPreviews } from "../services/linkPreviewCache.js";
export type { OwnProcesses } from "../services/ownProcesses.js";
// The instant-post civility check (src/shared/wordlist): slurs and strong profanity refused.
export { assertPassesWordlist } from "../shared/wordlist/index.js";

// --- Storage helpers (over host.db()) ---------------------------------------------------
export { HubDbError } from "../db/forHub.js";
export type { HubQueryBuilder } from "../db/forHub.js";
export { readAll } from "../db/readAll.js";

// --- Small utilities ----------------------------------------------------------------
export { generateId } from "../utils/id.js";
export { str, num } from "../utils/readField.js";

// --- The vote's ballots and receipts (src/modules/civic.receipts/) -----------------------
export {
  getVoteLog,
  verifyReceipt,
  recordOrUpdateVote,
  countVoters,
  getBallotChoicesForProcess,
  hasUserVoted,
  reshuffleBallotsForProcess,
  VoteRefusedError,
} from "../modules/civic.receipts/index.js";
export type { HeldReceipt } from "../modules/civic.receipts/index.js";
// The same, as a package casts and reads them (kernel step 1): process first.
export { ballots } from "../services/kernelBallots.js";

// --- Drafts and the drafting assistant (src/modules/civic.drafts/, src/models/assistant.ts) ----
export type {
  AssistantDraft,
  AssistantResponse,
  AssistantTypeConfig,
  CallAssistantInput,
  Category,
  DraftField,
  DraftProposal,
  DraftState,
  HubConfig,
  Phase,
  Suggestion,
} from "../models/assistant.js";
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
// A package's own drafting kind, as the kernel keeps it (kernel step 1).
export { draftsOf } from "../services/ownDrafts.js";
export type { OwnDrafts } from "../services/ownDrafts.js";

// --- Resident input on a process (src/modules/civic.input/) -----------------------------
export { getInputsByProcess, listVisibleInPhase, countVisibleOutsidePhase } from "../modules/civic.input/index.js";
export { inputs } from "../services/processInputs.js";

// --- Events (src/models/event.ts) ------------------------------------------------------
export type { CivicEvent, CreateEventInput } from "../models/event.js";

// --- Settings the hub keeps (src/services/hubSettings.ts) ------------------------------
export {
  getSupportThreshold,
  getSettingSync,
  hubDisplayNameSync,
  isPluginEnabledSync,
} from "../services/hubSettings.js";

// --- The hub in scope (src/config/hubContext.ts) ---------------------------------------
export { currentHubId } from "../config/hubContext.js";

// --- Acting on a process ---------------------------------------------------------------
export { closeThroughDispatcher, getActionDispatcher } from "../processes/serviceSlots.js";
export { afterActionCommits } from "../services/actionScope.js";
export { isPastDeadline } from "../utils/deadline.js";
export { AlreadyVotedError } from "../db/atomic.js";

// --- Brief content a process hands its brief (src/processes/contracts/briefContent.ts) ---
export type {
  BriefContent,
  BriefSection,
  BriefSourceResult,
  DeliberationResult,
  DeliberationSummary,
} from "../processes/contracts/briefContent.js";

// --- A submission as the review page shows it, and a source line as a content link -----
export { describeSubmissionFields } from "../shared/submissionPreview.js";
export { sourceLineToContentLink } from "../shared/sourceLine.js";

// --- Reporting (src/utils/reportError.ts) ----------------------------------------------
export { reportError } from "../utils/reportError.js";

// --- src/services/creatorDisplay.ts ------------------------------------------------------
export { enrichCreator, enrichCreators, PUBLIC_ADMIN_NAME } from "../services/creatorDisplay.js";

// --- Who did something, under the disclosure policy (src/services/disclosedNames.ts; A3) ----
export { namesFor } from "../services/disclosedNames.js";
export { notify } from "../services/notices.js";
export type { Notice, NoticeReport } from "../services/notices.js";
export { hubContext, term } from "../services/pluginHubContext.js";
// --- The kernel's roles and words (kernel step 2, docs/KERNEL.md §3) ----------------------
export { KERNEL_ROLES, KERNEL_TERMS, namesRole } from "../shared/spaceProfile.js";
export type { KernelRole, KernelTerm } from "../shared/spaceProfile.js";
export { seal, open as openSealed, sealingAvailable } from "../services/sealedSecrets.js";
export { privateFetchAllowed } from "../config/devFlags.js";
// The platform's own contact address (an admin's last resort in a message).
export { PLATFORM_CONTACT_EMAIL } from "../shared/platform.js";
// A package's own settings (plugin.<id>.*) and the hub's public ones (kernel step 1).
export { settingsOf } from "../services/ownSettings.js";
export type { OwnSettings } from "../services/ownSettings.js";
export { guardedFetch } from "../utils/ssrfGuard.js";
export type { HubContext } from "../services/pluginHubContext.js";

// --- src/controllers/processController.ts ------------------------------------------------
export { actOnProcess, readAsPage, viewFor } from "../controllers/processController.js";

// --- src/config/hub.ts -------------------------------------------------------------------
export { defaultJurisdiction, processJurisdiction } from "../config/hub.js";

// --- src/modules/civic.process_links/ ----------------------------------------------------
export { validateLinkSet } from "../modules/civic.process_links/index.js";
export { links } from "../services/kernelLinks.js";

// --- Edits of a live process (src/services/processEdits.ts) ------------------------------
// Loaded on the first call, not with the SDK: the process handlers import their
// draft kinds while the registry loads, and processEdits imports the process service.
import type { applyEdit as applyEditNow } from "../services/processEdits.js";
export const applyEdit: typeof applyEditNow = async (...args) => (await import("../services/processEdits.js")).applyEdit(...args);

// --- src/services/sampleContent.ts -------------------------------------------------------
export { sampleDeliverySuppressed } from "../services/sampleContent.js";
// A delivery's report and the line an admin reads after publishing (src/shared/delivery.ts).
export type { DeliveryReport, HeldBackRecipient } from "../shared/delivery.js";
export { publishedMessage } from "../shared/delivery.js";
// The office a person speaks for, as requireOfficial finds it (src/shared/officialTypes.ts).
export type { OfficialIdentity } from "../shared/officialTypes.js";

// --- src/utils/baseUrl.ts ----------------------------------------------------------------
export { uiBaseUrl } from "../utils/baseUrl.js";

// --- src/modules/civic.link_preview/ -----------------------------------------------------
export { extractUrls } from "../modules/civic.link_preview/index.js";

// --- src/services/linkPreviewCache.ts ----------------------------------------------------
export { warmPreviewsInBackground } from "../services/linkPreviewCache.js";

// --- What a closed process came to, and the space's offices (kernel step 1, Briefs) -------
// Any item on the space, for a feature that works on items of every type (Pinning; kernel step 4).
export { items } from "../services/kernelItems.js";
export type { ItemSummary } from "../services/kernelItems.js";
export { results } from "../services/kernelResults.js";
export type { ResultSource, FreshResult } from "../services/kernelResults.js";
export { offices, recordAdminAct } from "../services/kernelOffices.js";

// --- The provider's inbox and a member's image (kernel step 4, Feedback) ------------------
// Writing to the people who maintain the software (src/services/providerInbox.ts),
// and the kernel's image upload, mounted on a feature's own path.
export { providerInbox, normalizePagePath } from "../services/providerInbox.js";
export type { ProviderMessage } from "../services/providerInbox.js";
export type { MosaicStatus as ProviderStatus, MosaicOrigin as ProviderOrigin } from "../db/platformFeedback.js";
export { handlePostImageUpload as imageUpload } from "../controllers/uploadController.js";
export { asEmailList } from "../models/hubSettings.js";

// --- What is new for admins in a window (kernel step 4, the Admin digest) ------------------
// Reviews, the packages' and features' queues, edits, the waitlist and job
// problems, counted for (since, until], and the features' notes.
export { adminWindow } from "../modules/civic.admin_waiting/index.js";
export type { AdminWindow, DigestDetail, DigestLine, DigestLineId } from "../modules/civic.admin_waiting/index.js";

// --- The kernel's search index (kernel step 4, Search) -------------------------------------
export { search } from "../services/kernelSearch.js";
export type { SearchQuery, SearchResultPage, SearchHit, SearchSort, SearchTypeKey } from "../modules/civic.search/index.js";

// --- The kernel's membership (kernel step 4, Members) --------------------------------------
// Who has joined the space in scope, never an address; what residents see of
// it is the Members plugin's.
export { membership } from "../services/members.js";
export type { Member, MemberSummary, MembersPage, AdminMember } from "../services/members.js";

// --- What a package checks and serves for a submission (kernel step 1, Conversations) -----
export { codeOfConduct } from "../services/kernelCodeOfConduct.js";
export type { CodeOfConductFinding } from "../services/kernelCodeOfConduct.js";
export { samples } from "../services/kernelSamples.js";

// --- src/modules/civic.auth/ -------------------------------------------------------------
export { getUser } from "../modules/civic.auth/index.js";

// --- src/utils/http.ts -------------------------------------------------------------------

// --- src/services/feedHealth.ts ----------------------------------------------------------
export { findBrokenPublications } from "../services/feedHealth.js";
export type { BrokenPublication } from "../services/feedHealth.js";

// --- A job's run, in words an admin can act on (src/jobs/describe.ts) ---------------------
export { brokenLinkProblem } from "../jobs/describe.js";

// --- src/jobs/types.ts -------------------------------------------------------------------
export type { JobOutcome, JobRunner } from "../jobs/types.js";

// --- src/adapters/video.ts ---------------------------------------------------------------
export type { TranscriptSegment } from "../adapters/video.js";

// --- src/utils/hubTime.ts ----------------------------------------------------------------
export { resolveTimeZone } from "../utils/hubTime.js";

// --- Types of the adapters' calls (src/adapters/ai.ts) -----------------------------------
export type { AiSingleTurnInput } from "../adapters/ai.js";

// --- What the resident digest reads and sends (features/digest; kernel step 3) -----------
// The members who asked for it and when each was last mailed; the hub's events
// recorded since a time (the job keeps the public ones); which processes are
// not public; a member's signed link that stops it; the hub's guarded mailer.
export { listSubscribedUsers, markDigestSent } from "../modules/civic.auth/index.js";
export { getEventsSince } from "../events/eventStore.js";
export { getHiddenProcessIds } from "../services/processService.js";
export { unsubscribeLinkFor, unsubscribeLinksAvailable } from "../services/unsubscribe.js";
export { sendEmail, unsentReason } from "../utils/email.js";
export { effectivePostalAddressSync } from "../services/hubSettings.js";
export { hourInZone } from "../utils/hubTime.js";
export { hubTimeZone } from "../services/hubTimeZone.js";
/**
 * The hub's process types (src/processes/registry.ts), loaded on first use:
 * the registry loads the packages, which import this SDK. Each type's
 * handler, and the path of a process's page.
 */
export async function processRegistry() {
  const r = await import("../processes/registry.js");
  return { handler: r.getProcessHandler, detailPath: r.processDetailPath };
}

// --- What the Writing assistant reads and asks (features/assistant; kernel step 3) -------
// The model, through the hub's AI gate; the reply tool and reading it back; the
// hub's identity and Code of Conduct as the model reads them; the hub's AI
// allowance; the hub's documents; a draft as the assistant sees it.
export { aiConverse, aiDefaultModel } from "../adapters/ai.js";
export type { AiConversationInput, AiMessage, AiResult } from "../adapters/ai.js";
export { buildRespondTool, RESPONSE_TOOL, toAssistantResponse } from "../services/assistantResponse.js";
export { codeOfConductText, getHubConfig } from "../services/codeOfConductAi.js";
export type { CallClaudeMultiTurnFn } from "../services/codeOfConductAi.js";
export { admitAiCall, currentAiLimits } from "../services/aiBudget.js";
export { hubDocument } from "../services/hubDocuments.js";
export { toDraftState } from "../services/codeOfConduct.js";
export { currentHub } from "../config/hubContext.js";

// --- Feature packages (src/plugins/feature.ts; ADR-016) ----------------------------------
// A hub feature built as a package is, and the one read capability it adds:
// the event log as counts (EventLogReader), never an event, an actor or a payload.
export type {
  ActorCountPlan,
  DayCount,
  EventLogReader,
  EventPair,
  FeatureConsoleSection,
  FeatureDigestLine,
  FeatureHost,
  FeatureQueue,
  FeaturePackage,
  FeatureRateLimit,
  FeatureServer,
  ProcessTypeSummary,
  PublicActivityItem,
  PublicActivityPage,
} from "../plugins/feature.js";

