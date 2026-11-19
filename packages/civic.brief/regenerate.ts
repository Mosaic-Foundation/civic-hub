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
// One summary per process (2026-10-13): what a process keeps from its
// written-up result (a conversation's summary, the kernel's results.kept) goes
// with the version. A brief not yet public: the process keeps it at once. A
// published brief: the process takes it when that version is published, keeps
// what it replaced, and emits its own civic.process.updated.

import {
  ConflictError,
  NotFoundError,
  emitEvent,
  processesOf,
  recordAdminAct,
  results,
  type BriefContent,
  type Process,
} from "@civic-social/plugin-sdk";
import { emitBriefUpdated } from "./events.js";
import { finalizeBriefContent } from "./finalize.js";
import { createBriefState } from "./service.js";
import type { BriefProcessState } from "./models.js";

const BRIEF_TYPE = "civic.brief";
/** The kernel's view of this package's processes (asked for where used: the SDK binds as the hub loads). */
const ownProcesses = () => processesOf(BRIEF_TYPE);

async function briefRecord(id: string): Promise<{ record: Process; state: BriefProcessState }> {
  const record = await ownProcesses().get(id);
  if (!record) throw new NotFoundError("Brief not found");
  return { record, state: record.state as unknown as BriefProcessState };
}

/** The brief its source would make now, normalized as a new brief's would be. */
async function freshContent(
  source: { id: string; type: string },
): Promise<{ content: BriefContent; source_state?: Record<string, unknown> } | null> {
  const fresh = await results.fresh(source.id);
  if (!fresh) return null;
  // Finished by the brief, as a new brief's content is (./onClosed.ts).
  const content = await finalizeBriefContent(fresh.content);
  if (fresh.closed_early) content.closed_early = fresh.closed_early;
  // The same normalization a new brief gets (fields, lists, image).
  const made = createBriefState({ source_process_id: source.id, source_process_type: source.type, content }).content;
  // What the process keeps from the written-up result (a conversation, its
  // summary) goes with the version, beside what its type handed over.
  const kept = await results.kept(source.id, made);
  const sourceState = fresh.source_state || kept ? { ...fresh.source_state, ...kept } : null;
  return { content: made, ...(sourceState ? { source_state: sourceState } : {}) };
}

/**
 * A brief regenerated before it was published is approved: its source takes
 * what that version brought. Called after approveBrief.
 */
export async function applyOnApproval(record: Process, actor: string): Promise<void> {
  const state = record.state as unknown as BriefProcessState;
  const pending = state.source_state_on_publish;
  if (!pending || state.publication_status !== "published") return;
  // The source first: if its write fails, the pending state is still here
  // to apply again (results.adopt skips what is already in place).
  await results.adopt(state.source_process_id, pending, { resultId: record.id, actor, at: new Date().toISOString() });
  state.source_state_on_publish = null;
  await ownProcesses().saveState(record);
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
  admin: { id: string; email: string | null },
): Promise<{ staged: boolean; state: BriefProcessState; record: Process }> {
  const { record, state } = await briefRecord(briefId);
  const source = await results.source(state.source_process_id);
  if (!source) throw new NotFoundError("The process this brief is about is gone.");
  if (!source.closed) {
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
    // Not public yet: the source takes what its type hands over when the
    // brief is approved, and keeps the written-up result now, as it did when
    // the brief was first made.
    state.source_state_on_publish = fresh.source_state ?? null;
    await results.keep(source.id, fresh.content, { resultId: record.id, at: now });
  }
  await emitBriefUpdated(ctx(record), admin.id, state);
  await ownProcesses().saveState(record);
  await recordAdminAct(admin, "brief.regenerate", { brief_id: record.id, source_process_id: source.id, staged });
  return { staged, state, record };
}

/** Publish a staged version: it replaces the published one in place. No email. */
export async function publishBriefRevision(
  briefId: string,
  admin: { id: string; email: string | null },
): Promise<{ state: BriefProcessState; record: Process }> {
  const { record, state } = await briefRecord(briefId);
  const revision = state.pending_revision;
  if (!revision) throw new ConflictError("There is no new version waiting.", "no_pending_revision");
  const now = new Date().toISOString();
  keep(state, now);
  state.content = revision.content;
  state.generated_at = revision.generated_at;
  // The source first: if its write fails, the version is still waiting and
  // Publish can be pressed again (results.adopt skips what is in place).
  await results.adopt(state.source_process_id, revision.source_state, { resultId: record.id, actor: admin.id, at: now });
  state.pending_revision = null;
  state.revised_at = now;
  await emitBriefUpdated(ctx(record), admin.id, state);
  await ownProcesses().saveState(record);
  await recordAdminAct(admin, "brief.revision_published", {
    brief_id: record.id,
    source_process_id: state.source_process_id,
    revised_at: now,
  });
  return { state, record };
}

/** Drop a staged version; the published one stays as it is. */
export async function discardBriefRevision(
  briefId: string,
  admin: { id: string; email: string | null },
): Promise<{ state: BriefProcessState; record: Process }> {
  const { record, state } = await briefRecord(briefId);
  if (!state.pending_revision) throw new ConflictError("There is no new version waiting.", "no_pending_revision");
  state.pending_revision = null;
  await emitBriefUpdated(ctx(record), admin.id, state);
  await ownProcesses().saveState(record);
  return { state, record };
}
