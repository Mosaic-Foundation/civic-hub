// civic.meeting_summary module — public surface
//
// A hub wishing to offer AI-generated meeting summaries registers this
// module via the process registry AND mounts the cron + admin + public
// routes. A hub that doesn't want the capability simply does neither —
// no other code paths depend on any symbol in this module.
//
// Dual archetype: this module is both a process-type module (registered
// in the registry, produces read models, emits lifecycle events) and
// hosts a service module (the scraping + summarization pipeline invoked
// by cron). The same pluggability rules apply to both halves: no direct
// hub imports, everything is injected.

export type {
  // Core data model
  MeetingSummaryApprovalStatus,
  MeetingSourceType,
  MeetingSummaryProcessState,
  SummaryBlock,
  // Inputs
  CreateMeetingSummaryInput,
  MeetingSummaryPatch,
  // Context + injected callbacks
  MeetingSummaryProcessContext,
  EmitEventFn,
  FetchHtmlFn,
  FetchXmlFn,
  FetchJsonFn,
  FetchPdfFn,
  FetchYouTubeTranscriptFn,
  TranscriptSegment,
  CallClaudeFn,
  // Configuration
  MeetingSummaryConfig,
  // Connector interface
  MeetingEntry,
  MeetingSourceConnector,
  SummarizeMeetingResult,
} from "./models.js";

export {
  AI_ATTRIBUTION_LABEL,
  approveMeetingSummary,
  buildProcessDescription,
  createMeetingSummaryState,
  editMeetingSummary,
  emitCreationEvents,
  getAdminReadModel,
  getAdminSummary,
  getPublicReadModel,
} from "./service.js";

export { UPGRADEABLE_SOURCE_TYPES } from "./models.js";

export {
  documentFingerprint,
  sourceFingerprints,
  videoFingerprint,
} from "./identity.js";

export {
  assertApprovalTransition,
  canApprove,
  canEdit,
  isPublished,
} from "./lifecycle.js";

export {
  buildCreateInput,
  buildDescription,
  discoverMeetings,
  parseJsonArray,
  summarizeMeeting,
} from "./pipeline.js";

export {
  buildDiscoveryPrompt,
  buildSummarizationPrompt,
  resolveEffectiveInstructions,
} from "./prompts.js";

export { floydMinutesConnector } from "./connectors/floydMinutes.js";

export {
  channelFeedUrl,
  cleanMeetingTitle,
  groupVideosIntoMeetings,
  isValidChannelId,
  matchesTitleFilter,
  parseChannelFeed,
  parseMeetingDateFromTitle,
  youtubeChannelConnector,
} from "./connectors/youtubeChannel.js";
export type { FeedVideo } from "./connectors/youtubeChannel.js";

export {
  discoverCollectionName,
  fetchWixAccessToken,
  normalizeWixDocUrl,
  parseWixMeetingDate,
  queryWixCollection,
  rowsToMeetings,
  wixCmsConnector,
} from "./connectors/wixCms.js";
export type { WixMeetingRow } from "./connectors/wixCms.js";

export const PROCESS_DESCRIPTOR = {
  type: "civic.meeting_summary",
  version: "0.1",
  lifecycle: {
    // Deviates from Civic Process Spec §6.2 in the same way civic.brief
    // does: "closed" is skipped because the process has no participation
    // window. See HANDOFF.md Slice 3 and Slice 6 notes.
    states: ["active", "finalized"],
    approval_sub_states: ["pending", "approved", "published"],
    paths: {
      standard: ["active", "finalized"],
    },
  },
  actions: [
    // All meeting-summary transitions happen via the cron + admin HTTP
    // surfaces (not /process/:id/action). The adapter throws on any
    // generic process action to surface misrouting.
  ],
  events: [
    "civic.process.created",
    "civic.process.aggregation_completed",
    "civic.process.updated",
    "civic.process.outcome_recorded",
    "civic.process.result_published",
  ],
} as const;
