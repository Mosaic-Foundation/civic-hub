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
  MeetingSummaryRevision,
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
  acceptRevision,
  AI_ATTRIBUTION_LABEL,
  approveMeetingSummary,
  discardRevision,
  stageRevision,
  buildProcessDescription,
  createMeetingSummaryState,
  editMeetingSummary,
  emitCreationEvents,
  effectiveQualityFlag,
  FlaggedSummaryError,
  getAdminReadModel,
  getAdminSummary,
  getPublicReadModel,
} from "./service.js";

export { UPGRADEABLE_SOURCE_TYPES } from "./models.js";

export {
  blocksHaveTimestamps,
  daysSinceMeeting,
  newestMeetingDate,
  FLAG_MESSAGES,
  isMeetingNotReady,
  isTimedTranscript,
  meetingHasHappened,
  MeetingNotReadyError,
  qualityFlag,
  RECORD_GRACE_DAYS,
  SOURCE_QUIET_DAYS,
  daysSetting,
  summaryPredatesMeeting,
  todayIso,
} from "./readiness.js";
export type { SummaryQualityFlag, SummaryQualityFlagKind } from "./readiness.js";

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
  blockCountGuidance,
  buildDiscoveryPrompt,
  buildSummarizationPrompt,
  resolveEffectiveInstructions,
} from "./prompts.js";

export { minutesPageConnector, sitePdfPattern } from "./connectors/minutesPage.js";

export {
  AUTO_ORDER,
  CONNECTORS,
  PAGE_CONNECTOR_IDS,
  canonicalConnectorId,
  isConfigured,
} from "./connectors/index.js";

export {
  resolveMeetingSummaryConfig,
  type MeetingSummaryResolution,
} from "./config.js";

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

// What this type is: its manifest, src/modules/civic.meeting_summary/manifest.ts.
