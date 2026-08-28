// civic.brief module — public surface
//
// The universal, admin-reviewed brief for any completed civic process.
// Runs alongside civic.vote_results (which still handles votes); covers
// conversation / proposal / project and any future type via each
// handler's `generateBrief`. A hub that doesn't want briefs simply doesn't
// register the handler — processes still close, just without a brief.

export type {
  BriefActionOutcome,
  BriefContent,
  BriefContentPatch,
  BriefProcessContext,
  BriefProcessState,
  BriefPublicationStatus,
  BriefRecipient,
  BriefSection,
  CreateBriefInput,
  EmitEventFn,
  FinalizeSourceFn,
  SendEmailFn,
} from "./models.js";

export {
  RECIPIENT_LABEL_MAX,
  approveBrief,
  createBriefState,
  editBrief,
  emitCreationEvents,
  getAdminReadModel,
  getAdminSummary,
  getPublicReadModel,
  normalizeRecipients,
  setRecipients,
} from "./service.js";

export {
  assertPublicationTransition,
  canApprove,
  canEdit,
  isPublished,
} from "./lifecycle.js";

export { formatBriefEmail } from "./email.js";

export type {
  BriefResponseRecord,
  BriefResponseStatus,
  PublicBriefResponse,
} from "./responses.js";
export {
  RESPONSE_BODY_MAX,
  FEED_ANCHOR_WINDOW_MS,
  isFeedAnchor,
  normalizeResponseBody,
  respondGate,
  responseExcerpt,
  responseStatus,
  toPublicResponses,
} from "./responses.js";
export { emitBriefResponseAdded } from "./events.js";

export const PROCESS_DESCRIPTOR = {
  type: "civic.brief",
  version: "0.1",
  lifecycle: {
    states: ["active", "closed", "finalized"],
    publication_sub_states: ["pending", "approved", "published"],
    paths: { standard: ["active", "closed", "finalized"] },
  },
  actions: [
    // All brief transitions happen via the admin HTTP surface, not process
    // actions — the admin routes orchestrate the approval sequence.
  ],
  events: [
    "civic.process.created",
    "civic.process.aggregation_completed",
    "civic.process.updated",
    "civic.process.outcome_recorded",
    "civic.process.result_published",
  ],
} as const;

export type { BriefIndexEntry } from "./service.js";
export {
  availableSourceTypes,
  availableYears,
  filterIndex,
  toIndexEntry,
} from "./service.js";
