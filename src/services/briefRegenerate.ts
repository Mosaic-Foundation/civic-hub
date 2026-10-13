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

import { ConflictError, NotFoundError } from "../errors/index.js";
import { emitEvent } from "../events/eventEmitter.js";
import { getProcessHandler } from "../processes/registry.js";
import { getProcess, isTerminalStatus, saveProcessState } from "./processService.js";
import { closedEarlyView } from "./closeEarly.js";
import { recordHubAdminAudit } from "./hubAdminAudit.js";
import { emitBriefUpdated } from "../modules/civic.brief/events.js";
import { createBriefState } from "../modules/civic.brief/service.js";
import type { BriefContent, BriefProcessState } from "../modules/civic.brief/models.js";
import type { Process } from "../models/process.js";

const BRIEF_TYPE = "civic.brief";

async function briefRecord(id: string): Promise<{ record: Process; state: BriefProcessState }> {
  const record = await getProcess(id);
  if (!record || record.definition.type !== BRIEF_TYPE) throw new NotFoundError("Brief not found");
  return { record, state: record.state as unknown as BriefProcessState };
}

/** The brief its source would make now, normalized as a new brief's would be. */
async function freshContent(source: Process): Promise<BriefContent | null> {
  const handler = getProcessHandler(source.definition.type);
  if (!handler?.generateBrief) return null;
  const content = handler.regenerateBrief ? await handler.regenerateBrief(source) : await handler.generateBrief(source);
  if (!content) return null;
  const early = closedEarlyView(source.state);
  if (early) content.closed_early = { line: early.line, note: early.note };
  // The same normalization a new brief gets (fields, lists, image).
  return createBriefState({ source_process_id: source.id, source_process_type: source.definition.type, content }).content;
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
  const content = await freshContent(source);
  if (!content) {
    throw new ConflictError(
      "A new version couldn't be made just now (the summary isn't available). Try again later.",
      "brief_not_regenerated",
    );
  }
  const now = new Date().toISOString();
  const staged = state.publication_status === "published";
  if (staged) {
    state.pending_revision = { content, generated_at: now };
  } else {
    keep(state, now);
    state.content = content;
    state.generated_at = now;
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
