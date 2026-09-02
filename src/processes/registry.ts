// Process registry — maps process types to their handlers.
//
// This registry enables a plugin-style architecture for civic processes.
// Each process type (e.g. civic.vote, civic.proposal) implements a handler.
// Future work may allow dynamic loading, but for now this is static.

import { ProcessHandler, ProcessFactory, ActionDispatcher } from "./types.js";
import voteProcess from "./voteProcess.js";
import proposalAdapter from "./proposalAdapter.js";
import projectAdapter from "./projectAdapter.js";
import voteResultsProcess from "./voteResultsProcess.js";
import briefProcess from "./briefProcess.js";
import announcementProcess from "./announcementProcess.js";
import meetingSummaryProcess from "./meetingSummaryProcess.js";
import { bootDeliberation } from "./deliberationBoot.js";
import {
  describeSubmissionFields,
  type SubmissionField,
  type SubmissionSource,
} from "../shared/submissionPreview.js";
import wordcloudProcess from "./wordcloudProcess.js";

// civic.vote_results + civic.announcement + civic.meeting_summary are
// registered here but can be omitted by hubs that don't want those
// capabilities. When civic.vote_results is present, the vote adapter
// spawns a vote-results record on close; when absent, vote closes
// terminate without a published results page. civic.announcement is
// entirely self-contained via /announcement routes.
// civic.meeting_summary is self-contained via /meeting-summary and
// /admin/meeting-summaries, plus the cron endpoint at
// /internal/meeting-summary/run — a hub that omits this module simply
// doesn't mount those routes and nothing else breaks.
//
// Historical note: the civic.vote_results module was named civic.brief
// through Slice 8. Slice 8.5 renamed it to align the codebase with the
// user-facing concept ("Vote results"). Existing process rows are
// migrated by 20260427000000_rename_civic_brief_to_vote_results.sql.
const processRegistry: Record<string, ProcessHandler> = {
  "civic.vote": voteProcess,
  "civic.proposal": proposalAdapter,
  "civic.project": projectAdapter,
  "civic.vote_results": voteResultsProcess,
  "civic.brief": briefProcess,
  "civic.announcement": announcementProcess,
  "civic.meeting_summary": meetingSummaryProcess,
  "civic.polis_deliberation": bootDeliberation(),
  "civic.wordcloud": wordcloudProcess,
};

/**
 * Process factory — set by the service layer at startup.
 * Allows handlers to create new processes without importing processService directly.
 */
let processFactory: ProcessFactory | null = null;

export function setProcessFactory(factory: ProcessFactory): void {
  processFactory = factory;
}

export function getProcessFactory(): ProcessFactory {
  if (!processFactory) {
    throw new Error("Process factory not initialized — service layer must call setProcessFactory()");
  }
  return processFactory;
}

/**
 * Action dispatcher — set by the service layer at startup (mirrors the process
 * factory). Lets handlers dispatch a persisted action (e.g. their close action
 * for lazy deadline-close) through executeAction without importing
 * processService directly.
 */
let actionDispatcher: ActionDispatcher | null = null;

export function setActionDispatcher(dispatcher: ActionDispatcher): void {
  actionDispatcher = dispatcher;
}

export function getActionDispatcher(): ActionDispatcher {
  if (!actionDispatcher) {
    throw new Error("Action dispatcher not initialized — service layer must call setActionDispatcher()");
  }
  return actionDispatcher;
}

/**
 * Look up the handler for a given process type.
 * Returns undefined if no handler is registered.
 */
export function getProcessHandler(type: string): ProcessHandler | undefined {
  return processRegistry[type];
}

/** List all registered process types */
export function getRegisteredTypes(): string[] {
  return Object.keys(processRegistry);
}

/**
 * Every registered handler. Used by the schema contract to collect the
 * storage each enabled process type declares — a hub that omits a module
 * drops that module's expectations along with it.
 */
export function getAllHandlers(): ProcessHandler[] {
  return Object.values(processRegistry);
}

/**
 * The canonical public UI path for a process, resolved from its handler.
 *
 * The single place the app turns (type, id) into a link. Handlers declare
 * `detailPath`; anything without one — including a type this hub does not
 * have registered at all — falls back to the generic process route, which
 * always resolves. Callers (link cards, search hits) therefore never need to
 * know which process types exist.
 */
export function processDetailPath(type: string, id: string): string {
  const handler = processRegistry[type];
  return handler?.detailPath?.(id) ?? `/process/${id}`;
}

/**
 * Everything the creator submitted, as displayable fields — for the review
 * previews (creator + admin). Handlers may extend the generic default via
 * `describeSubmission`; a type without one — including a type registered
 * tomorrow — gets the generic walk of its `content` block, so nothing it
 * submits is hidden. See src/shared/submissionPreview.ts.
 */
/** Where a creator revises one of this type's drafts, or null when the type
 *  declares no drafting page. */
export function draftPathFor(type: string, draftId: string): string | null {
  return processRegistry[type]?.draftPath?.(draftId) ?? null;
}

/** Put a submitted draft back into "drafting" through its type's handler. */
export async function reopenDraftForRevision(type: string, draftId: string): Promise<void> {
  const handler = processRegistry[type];
  if (!handler?.reopenDraft) {
    throw new Error(`Process type ${type} does not support revising a draft`);
  }
  await handler.reopenDraft(draftId);
}

export function describeSubmission(source: SubmissionSource): SubmissionField[] {
  const handler = processRegistry[source.type];
  return handler?.describeSubmission?.(source) ?? describeSubmissionFields(source);
}
