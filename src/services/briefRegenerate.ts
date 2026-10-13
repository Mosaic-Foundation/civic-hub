// Regenerate a brief (Actions slice, 2026-10-13). An admin can make a closed
// process's brief again: after a Close early with a note, or when the AI
// summary was poor.
//
//   - A brief not yet published: the new version replaces it at once (it is
//     still the admin's draft to review and approve).
//   - A published brief: the new version is staged (`pending_revision`) and
//     an admin publishes it ("Publish this version") or discards it. Adam
//     chose staging (2026-10-13): a summary that was poor once can be poor
//     again. Publishing replaces the brief's content in place: its page and
//     its one feed card show the new version, marked "Updated <date>", and
//     nobody is emailed again.
//
// Every replaced version is kept in the brief's `history`. Each step emits
// the brief's civic.process.updated, and the hub admin audit log records who
// regenerated and who published.
//
// One summary per process (2026-10-13): a type whose regenerated brief brings
// new state for the process itself (a conversation's summary) hands it over
// with the version; when that version is published (Publish this version, or
// approving a brief regenerated before it was public) the process takes it,
// keeps what it replaced, and emits its own civic.process.updated.

import { ConflictError, NotFoundError } from "../errors/index.js";
import { emitEvent } from "../events/eventEmitter.js";
import { getProcessHandler, processDetailPath } from "../processes/registry.js";
import { getProcess, isTerminalStatus, saveProcessState } from "./processService.js";
import { closedEarlyView } from "./closeEarly.js";
import { recordHubAdminAudit } from "./hubAdminAudit.js";
import { emitBriefUpdated } from "../modules/civic.brief/events.js";
import { createBriefState } from "../modules/civic.brief/service.js";
import type { BriefContent, BriefProcessState } from "../modules/civic.brief/models.js";
import type { Process } from "../models/process.js";
import type { RegeneratedBrief } from "../processes/types.js";

const BRIEF_TYPE = "civic.brief";

async function briefRecord(id: string): Promise<{ record: Process; state: BriefProcessState }> {
  const record = await getProcess(id);
  if (!record || record.definition.type !== BRIEF_TYPE) throw new NotFoundError("Brief not found");
  return { record, state: record.state as unknown as BriefProcessState };
}

/** The brief its source would make now, normalized as a new brief's would be. */
async function freshContent(source: Process): Promise<RegeneratedBrief | null> {
  const handler = getProcessHandler(source.definition.type);
  if (!handler?.generateBrief) return null;
  const fresh: RegeneratedBrief | null = handler.regenerateBrief
    ? await handler.regenerateBrief(source)
    : await Promise.resolve(handler.generateBrief(source)).then((c) => (c ? { content: c } : null));
  if (!fresh) return null;
  const content = fresh.content;
  const early = closedEarlyView(source.state);
  if (early) content.closed_early = { line: early.line, note: early.note };
  // The same normalization a new brief gets (fields, lists, image).
  return {
    content: createBriefState({ source_process_id: source.id, source_process_type: source.definition.type, content }).content,
    ...(fresh.source_state ? { source_state: fresh.source_state } : {}),
  };
}

/**
 * The source process takes the state a published version brought (a
 * conversation's new summary). The values it replaces are kept on the
 * process, and the process emits civic.process.updated.
 */
async function applySourceState(
  sourceId: string,
  sourceState: Record<string, unknown> | null | undefined,
  brief: Process,
  actor: string,
  now: string,
): Promise<void> {
  if (!sourceState || Object.keys(sourceState).length === 0) return;
  const source = await getProcess(sourceId);
  if (!source) return;
  const state = source.state as Record<string, unknown>;
  const previous = Object.fromEntries(Object.keys(sourceState).map((k) => [k, state[k] ?? null]));
  const kept = Array.isArray(state.brief_revisions) ? (state.brief_revisions as unknown[]) : [];
  source.state = { ...state, ...sourceState, brief_revisions: [...kept, { brief_id: brief.id, replaced_at: now, previous }] };
  await saveProcessState(source);
  await emitEvent({
    event_type: "civic.process.updated",
    actor,
    process_id: source.id,
    jurisdiction: source.jurisdiction,
    processType: source.definition.type,
    action_url_path: processDetailPath(source.definition.type, source.id),
    data: { brief_revision: { brief_id: brief.id, fields: Object.keys(sourceState) } },
  });
}

/**
 * A brief regenerated before it was published is approved: its source takes
 * what that version brought. Called after approveBrief.
 */
export async function applyOnApproval(record: Process, actor: string): Promise<void> {
  const state = record.state as unknown as BriefProcessState;
  const pending = state.source_state_on_publish;
  if (!pending || state.publication_status !== "published") return;
  state.source_state_on_publish = null;
  await saveProcessState(record);
  await applySourceState(state.source_process_id, pending, record, actor, new Date().toISOString());
}

function ctx(record: Process) {
  return { process_id: record.id, jurisdiction: record.jurisdiction, emit: emitEvent };
}

/** Keep the version being replaced. */
function keep(state: BriefProcessState, now: string): void {
  state.history = [...(state.history ?? []), { content: state.content, generated_at: state.generated_at, replaced_at: now }];
}

export async function regenerateBrief(
  briefId: string,
  admin: { id: string; email: string },
): Promise<{ staged: boolean; state: BriefProcessState; record: Process }> {
  const { record, state } = await briefRecord(briefId);
  const source = await getProcess(state.source_process_id);
  if (!source) throw new NotFoundError("The process this brief is about is gone.");
  if (!isTerminalStatus(source.status)) {
    throw new ConflictError("A brief can be made again only once its process has closed.", "source_not_closed");
  }
  const fresh = await freshContent(source);
  if (!fresh) {
    throw new ConflictError(
      "A new version couldn't be made just now (the summary isn't available). Try again later.",
      "brief_not_regenerated",
    );
  }
  const now = new Date().toISOString();
  const staged = state.publication_status === "published";
  if (staged) {
    state.pending_revision = {
      content: fresh.content,
      generated_at: now,
      ...(fresh.source_state ? { source_state: fresh.source_state } : {}),
    };
  } else {
    keep(state, now);
    state.content = fresh.content;
    state.generated_at = now;
    // Not public yet: the source takes it when the brief is approved.
    state.source_state_on_publish = fresh.source_state ?? null;
  }
  await emitBriefUpdated(ctx(record), admin.id, state);
  await saveProcessState(record);
  await recordHubAdminAudit({
    actor: admin.email,
    action: "brief.regenerate",
    after: { brief_id: record.id, source_process_id: source.id, staged },
  });
  return { staged, state, record };
}

/** Publish a staged version: it replaces the published one in place. No email. */
export async function publishBriefRevision(
  briefId: string,
  admin: { id: string; email: string },
): Promise<{ state: BriefProcessState; record: Process }> {
  const { record, state } = await briefRecord(briefId);
  const revision = state.pending_revision;
  if (!revision) throw new ConflictError("There is no new version waiting.", "no_pending_revision");
  const now = new Date().toISOString();
  keep(state, now);
  state.content = revision.content;
  state.generated_at = revision.generated_at;
  state.pending_revision = null;
  state.revised_at = now;
  await emitBriefUpdated(ctx(record), admin.id, state);
  await saveProcessState(record);
  await applySourceState(state.source_process_id, revision.source_state, record, admin.id, now);
  await recordHubAdminAudit({
    actor: admin.email,
    action: "brief.revision_published",
    after: { brief_id: record.id, source_process_id: state.source_process_id, revised_at: now },
  });
  return { state, record };
}

/** Drop a staged version; the published one stays as it is. */
export async function discardBriefRevision(
  briefId: string,
  admin: { id: string; email: string },
): Promise<{ state: BriefProcessState; record: Process }> {
  const { record, state } = await briefRecord(briefId);
  if (!state.pending_revision) throw new ConflictError("There is no new version waiting.", "no_pending_revision");
  state.pending_revision = null;
  await emitBriefUpdated(ctx(record), admin.id, state);
  await saveProcessState(record);
  return { state, record };
}
