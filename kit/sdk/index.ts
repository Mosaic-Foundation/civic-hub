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
  ClosedProcess,
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
  // Sample content a package seeds (PluginServer.samples, kernel step 3).
  PluginSamples,
  PluginSampleTemplate,
  SampleKit,
  SampleTemplate,
  SampleRow,
  SampleRefreshWindow,
} from "../../src/sdk/index.js";

// --- The one emission path: every event a package writes goes through it ------------------
export { emitEvent } from "../../src/sdk/index.js";
// An event built but not written, for a kernel call that writes it in its own transaction
// (a ballot and its vote_submitted event, ballots.cast).
export { buildEvent } from "../../src/sdk/index.js";

// --- A type residents draft: its kind; the drafts routes, the Code of Conduct gate and the
// review queue are the hub's (docs/PLUGIN-PACKAGE.md, "drafts") --------------------------------
export type { Draft, DraftKind, OwnDrafts, AssistantTypeConfig, DraftField, ProposedLink } from "../../src/sdk/index.js";
// Its drafts (draftsOf(kind): get, create, update, setStatus, and the store the drafting
// assistant uses), and the assistant config it declares.
export { draftsOf, DAY_MS, lines } from "../../src/sdk/index.js";

// --- What people wrote on a process (comments, updates), as the kernel keeps it -------------------
export { inputs } from "../../src/sdk/index.js";

// --- Links between processes: a proposed set, checked ------------------------------------------
export { links } from "../../src/sdk/index.js";

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
export { hubContext, term } from "../../src/sdk/index.js";
export type { HubContext } from "../../src/sdk/index.js";

// --- Its own records, on the database its host hands it (its granted tables only) ----------
export { storeSlot, HubDbError, readAll, readProcessState, writeProcessState } from "../../src/sdk/index.js";
export type { StoreSlot } from "../../src/sdk/index.js";
export type { CreateProcessInput } from "../../src/sdk/index.js";

// --- Its own processes (kernel step 1): read only those of the types it declares ---------
export { processesOf } from "../../src/sdk/index.js";
export type { OwnProcesses } from "../../src/sdk/index.js";

// --- Posting for the space (kernel step 1): an administrator or a listed author, and the
// byline the admins set for them; the author's public role is the kernel's accountable role ---
export { requireAuthor, authorshipOf } from "../../src/sdk/index.js";
export type { AuthorOf } from "../../src/sdk/index.js";

// --- People shown (kernel step 1): a record's creator as this reader may see them, the raw
// account id redacted; the name the public sees for an administrator ------------------------
export { enrichCreator, enrichCreators, PUBLIC_ADMIN_NAME } from "../../src/sdk/index.js";

// --- Link previews (kernel step 1): the URLs in a text, and fetching their previews ahead
// of the first reader, in the background ------------------------------------------------------
export { extractUrls, warmLinkPreviews } from "../../src/sdk/index.js";

// --- Moderation of instant posts: the space's word list (slurs and strong profanity);
// a refusal is a ValidationError the hub answers with its message ---------------------------
export { assertPassesWordlist } from "../../src/sdk/index.js";

// --- Routes of its own, when it needs them ---------------------------------------------------
export { route, getAuthUser, requireResident, requireAdmin, resolveCallerId, resolveCallerIsAdmin } from "../../src/sdk/index.js";

// --- Its own settings (kernel step 1): plugin.<id>.* as the hub's admins set them, whether
// it is switched on, and the hub's public settings (its time zone, its governing body) --------
export { settingsOf } from "../../src/sdk/index.js";
export type { OwnSettings } from "../../src/sdk/index.js";

// --- Telling the hub's admins a scheduled job needs them (kernel step 1): what a broken
// published link means to them, the platform's own address as their last resort -------------
export { brokenLinkProblem, findBrokenPublications, PLATFORM_CONTACT_EMAIL } from "../../src/sdk/index.js";
export type { BrokenPublication } from "../../src/sdk/index.js";

// --- Adapter shapes a package hands its own code (a video's transcript, one model turn) ------
export type { TranscriptSegment, AiSingleTurnInput } from "../../src/sdk/index.js";

// --- The hub's time zone, from a setting's raw value (an unset or unknown zone → the default) --
export { resolveTimeZone } from "../../src/sdk/index.js";

// --- Secret ballots (kernel step 1): cast, count, log and check them on its own processes;
// the kernel keeps them, with no link from a voter to a ballot (the voter holds the receipt) ---
export { ballots, VoteRefusedError, AlreadyVotedError } from "../../src/sdk/index.js";
export type { HeldReceipt } from "../../src/sdk/index.js";

// --- What the review page shows of a submission (a type extends the generic walk with its
// own state keys), and a "Label — url" source line as a content link --------------------------
export { describeSubmissionFields, sourceLineToContentLink } from "../../src/sdk/index.js";

// --- Telling the operators something went wrong that nobody is waiting on ------------------
export { reportError } from "../../src/sdk/index.js";

// --- Small utilities -------------------------------------------------------------------------
export { generateId, str, num } from "../../src/sdk/index.js";

// --- Results: what a closed process came to, and settling it once public (since Briefs) ----
// A process of any type says what it came to (the process.result contract); the package
// that writes results up reads it and settles the process here (docs/kernel/SURFACE.md).
export { results } from "../../src/sdk/index.js";
export type { ResultSource, FreshResult, DeliberationResult, DeliberationSummary } from "../../src/sdk/index.js";

// --- Offices: officials going on the record, and who a result goes to (since Briefs) ------
export { offices, requireOfficial, recordAdminAct } from "../../src/sdk/index.js";
export type { OfficialIdentity } from "../../src/sdk/index.js";

// --- Delivering a result: the mail adapter's report, and a sample's held-back delivery ----
export { publishedMessage, sampleDeliverySuppressed } from "../../src/sdk/index.js";
export type { DeliveryReport, HeldBackRecipient } from "../../src/sdk/index.js";

// --- Submitting outside a draft, and serving a sample (since Conversations) ---------------
// The hub's automated Code of Conduct check on text a person submits (processesOf(...).submit
// takes its answer), and the hub's sample content a type serves beyond its row.
export { codeOfConduct, samples } from "../../src/sdk/index.js";
export type { CodeOfConductFinding } from "../../src/sdk/index.js";
export type { RegeneratedBrief } from "../../src/sdk/index.js";

// --- The kernel's roles and words (kernel step 2): member, moderator, admin, accountable; and
// the words a space type's profile names ("resident", "official", "hub" on a Civic Hub).
// term("member", 2) reads the space's own word, else its profile's, else the neutral word.
export { KERNEL_ROLES, KERNEL_TERMS, namesRole } from "../../src/sdk/index.js";
export type { KernelRole, KernelTerm } from "../../src/sdk/index.js";
