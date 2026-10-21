// civic.vote_results module — public surface
//
// A hub wishing to offer admin-reviewed vote results registers this
// module via the process registry. A hub that doesn't want them simply
// doesn't register it — no other code paths depend on the module being
// present (votes still close, just without a published results page).

export type {
  CreateVoteResultsFromVoteInput,
  EmitEventFn,
  FinalizeLinkedVoteFn,
  SendEmailFn,
  VoteContextSnapshot,
  VoteResultsActionOutcome,
  VoteResultsContent,
  VoteResultsContentPatch,
  VoteResultsPositionBreakdown,
  VoteResultsProcessContext,
  VoteResultsProcessState,
  VoteResultsPublicationStatus,
} from "./models.js";

export {
  approveVoteResults,
  createVoteResultsState,
  editVoteResults,
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

export { formatVoteResultsEmail, headlineFor } from "./email.js";

// What this type is: its manifest, src/modules/civic.vote_results/manifest.ts.
