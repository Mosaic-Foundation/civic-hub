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

// What a source hands its brief to finish with the AI (./finalize.ts).
export { finalizeBriefContent } from "./finalize.js";

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

// What this type is: its manifest, ./manifest.ts.

export type { BriefIndexEntry } from "./service.js";
export {
  availableSourceTypes,
  availableYears,
  filterIndex,
  toIndexEntry,
} from "./service.js";
