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
  BriefSection,
  CreateBriefInput,
  EmitEventFn,
  FinalizeSourceFn,
  SendEmailFn,
} from "./models.js";

export {
  approveBrief,
  createBriefState,
  editBrief,
  emitCreationEvents,
  getAdminReadModel,
  getAdminSummary,
  getPublicReadModel,
} from "./service.js";

export {
  assertPublicationTransition,
  canApprove,
  canEdit,
  isPublished,
} from "./lifecycle.js";

export { formatBriefEmail } from "./email.js";

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
