// Creator edits of a LIVE process — visible history, supporters notified.
//
// Adam (2026-09-03): project owners need to change the description, sources
// and banner after publishing, not just append updates; but people who
// supported the project signed on to particular words. So: edits are allowed
// where the type's handler says so (only civic.project declares editPolicy),
// every edit is recorded as a civic.process.updated event carrying the
// before/after of each changed field (the event log is the source of
// truth — no new table), the page shows "Edited … · see what changed", and
// supporters who take the digest get one line about it in their next
// digest (never a per-edit email). A progress update (project updates log)
// is not an edit and never triggers any of this.
//
// Flow: POST /process/:id/edit reopens the draft the process came from
// (the same reopen the revise flow uses) and sends the creator to the real
// drafting form with ?draft=&edit=; the draft's submit controller passes
// edit_process_id and this service applies the diff in place.

import { getDb } from "../db/client.js";
import { emitEvent } from "../events/eventEmitter.js";
import { getEventsByProcessId } from "../events/eventStore.js";
import type { Process } from "../models/process.js";
import type { EditChangeSet, EditPolicy } from "../processes/types.js";
import {
  draftPathFor,
  getProcessHandler,
  processDetailPath,
  reopenDraftForRevision,
} from "../processes/registry.js";
import { getReviewByProcessId } from "../modules/civic.review/service.js";
import { validateLinkSet } from "../modules/civic.process_links/index.js";
import { createEdges, getEdgesFor } from "./processLinks.js";
import { getProcess } from "./processService.js";
import { isAdminEmail } from "../middleware/auth.js";

export interface Editor {
  id: string;
  email: string;
}

export interface EditInput {
  title?: string;
  description?: string;
  content?: Record<string, unknown>;
  links?: Array<{ to_id: string; relation: string }>;
}

/** The submitted fields an edit may touch; `content.*` keys are compared individually. */
const CONTENT_KEYS_IGNORED = new Set(["assistant_helped"]);

const NOT_EDITABLE: EditPolicy = {
  editable: false,
  locked_fields: [],
  reason: "This kind of process cannot be edited after it is submitted.",
};

function isCreator(process: Process, editor: Editor): boolean {
  return process.createdBy === editor.id;
}

/** Policy for a viewer: the handler's answer, gated by creator-or-admin. */
export async function getEditPolicy(process: Process, editor: Editor): Promise<EditPolicy> {
  const handler = getProcessHandler(process.definition.type);
  if (!handler?.editPolicy) return NOT_EDITABLE;
  if (!isCreator(process, editor) && !isAdminEmail(editor.email)) {
    return { editable: false, locked_fields: [], reason: "Only the creator or an admin can edit this." };
  }
  return handler.editPolicy(process);
}

/**
 * Reopen the draft this process was submitted from and say where to go.
 * Null draft when the process predates drafts (created before 2026-08).
 */
export async function startEdit(
  process: Process,
  editor: Editor,
): Promise<{ draft_id: string; draft_path: string; locked_fields: string[] }> {
  const policy = await getEditPolicy(process, editor);
  if (!policy.editable) throw new EditError(policy.reason ?? "Not editable", 403);
  const review = await getReviewByProcessId(process.id);
  if (!review?.draft_id) {
    throw new EditError("This item predates editing — it has no draft on record.", 409);
  }
  const type = process.definition.type;
  const base = draftPathFor(type, review.draft_id);
  if (!base) throw new EditError("This kind of process has no drafting page.", 409);
  await reopenDraftForRevision(type, review.draft_id);
  const sep = base.includes("?") ? "&" : "?";
  const locked = policy.locked_fields.length ? `&locked=${encodeURIComponent(policy.locked_fields.join(","))}` : "";
  return {
    draft_id: review.draft_id,
    draft_path: `${base}${sep}edit=${encodeURIComponent(process.id)}${locked}`,
    locked_fields: policy.locked_fields,
  };
}

/** Pure: which submitted fields differ, with before/after for each. */
export function diffEdit(
  current: { title: string; description: string; content: Record<string, unknown>; links: Array<{ to_id: string; relation: string }> },
  next: EditInput,
  lockedFields: string[],
): EditChangeSet {
  const changed: string[] = [];
  const previous: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const locked = new Set(lockedFields);

  if (next.title !== undefined && !locked.has("title") && next.title.trim() !== current.title.trim()) {
    changed.push("title"); previous.title = current.title; after.title = next.title.trim();
  }
  if (next.description !== undefined && !locked.has("description") && next.description.trim() !== (current.description ?? "").trim()) {
    changed.push("description"); previous.description = current.description ?? ""; after.description = next.description.trim();
  }
  if (next.content) {
    const keys = new Set([...Object.keys(current.content ?? {}), ...Object.keys(next.content)]);
    for (const key of keys) {
      if (CONTENT_KEYS_IGNORED.has(key) || locked.has(key)) continue;
      if (!(key in next.content)) continue; // the draft does not carry this key — leave it
      const a = JSON.stringify(current.content?.[key] ?? null);
      const b = JSON.stringify(next.content[key] ?? null);
      if (a !== b) { changed.push(key); previous[key] = current.content?.[key] ?? null; after[key] = next.content[key] ?? null; }
    }
  }
  if (next.links && !locked.has("links")) {
    const norm = (l: Array<{ to_id: string; relation: string }>) => [...l].map((x) => `${x.relation}:${x.to_id}`).sort().join("|");
    if (norm(next.links) !== norm(current.links)) {
      changed.push("links"); previous.links = current.links; after.links = next.links;
    }
  }
  return { changed_fields: changed, previous, current: after };
}

export class EditError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/**
 * Apply an edit in place: processes row, creator links, the handler's own
 * table, one event with the diff, and the supporters' email. Returns the
 * change set (empty when nothing actually changed — then nothing is written).
 */
export async function applyEdit(
  processId: string,
  editor: Editor,
  input: EditInput,
): Promise<EditChangeSet> {
  const process = await getProcess(processId);
  if (!process) throw new EditError("Process not found", 404);
  const policy = await getEditPolicy(process, editor);
  if (!policy.editable) throw new EditError(policy.reason ?? "Not editable", 403);

  const edges = await getEdgesFor(processId);
  const currentLinks = edges
    .filter((e) => e.from_id === processId && e.created_by === process.createdBy)
    .map((e) => ({ to_id: e.to_id, relation: e.relation }));
  const changes = diffEdit(
    {
      title: process.title,
      description: process.description,
      content: (process.content ?? {}) as Record<string, unknown>,
      links: currentLinks,
    },
    input,
    policy.locked_fields,
  );
  if (changes.changed_fields.length === 0) return changes;

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };
  if ("title" in changes.current) updates.title = changes.current.title;
  if ("description" in changes.current) updates.description = changes.current.description;
  const contentChanged = changes.changed_fields.filter((f) => !["title", "description", "links"].includes(f));
  if (contentChanged.length) {
    const content = { ...((process.content ?? {}) as Record<string, unknown>) };
    for (const key of contentChanged) content[key] = changes.current[key];
    updates.content = content;
  }
  const { error } = await getDb().from("processes").update(updates).eq("id", processId);
  if (error) throw new EditError(`Failed to save edit: ${error.message}`, 500);

  if (changes.changed_fields.includes("links")) {
    await getDb().from("process_links").delete().eq("from_id", processId).eq("created_by", process.createdBy);
    const links = input.links ?? [];
    if (links.length) {
      try {
        await createEdges(processId, validateLinkSet(processId, links), process.createdBy);
      } catch (err) {
        console.warn(`[edits] dropped invalid links on edit of ${processId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const handler = getProcessHandler(process.definition.type);
  await handler?.onEdited?.(process, changes);

  const editorRole = isCreator(process, editor) ? "creator" : "admin";
  await emitEvent({
    event_type: "civic.process.updated",
    actor: editor.id,
    process_id: processId,
    hub_id: process.hubId,
    jurisdiction: process.jurisdiction,
    processType: process.definition.type,
    action_url_path: processDetailPath(process.definition.type, processId),
    data: {
      edit: {
        changed_fields: changes.changed_fields,
        previous: changes.previous,
        current: changes.current,
        editor_role: editorRole,
      },
    },
  });

  // No immediate email (Adam, 2026-09-03: not "every time any little edit
  // has been made"). Supporters who take the digest get ONE line per edited
  // project in their next digest — see civic.digest buildEditItems, which
  // reads the same event and the handler's listSupporters.

  return changes;
}

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  description: "description",
  sources: "sources",
  banner_image_url: "banner image",
  banner_image_alt: "banner image description",
  links: "related processes",
};

export function labelForField(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ");
}

export interface PublicEdit {
  id: string;
  at: string;
  editor_role: "creator" | "admin";
  changed_fields: string[];
  previous: Record<string, unknown>;
  current: Record<string, unknown>;
}

/** Every recorded edit of a process, newest first — read from the event log. */
export async function listEdits(processId: string): Promise<PublicEdit[]> {
  const events = await getEventsByProcessId(processId);
  const out: PublicEdit[] = [];
  for (const ev of events) {
    if (ev.event_type !== "civic.process.updated") continue;
    const edit = (ev.data as { edit?: unknown } | null)?.edit as
      | { changed_fields?: unknown; previous?: unknown; current?: unknown; editor_role?: unknown }
      | undefined;
    if (!edit || !Array.isArray(edit.changed_fields)) continue;
    out.push({
      id: ev.id,
      at: ev.timestamp,
      editor_role: edit.editor_role === "admin" ? "admin" : "creator",
      changed_fields: edit.changed_fields as string[],
      previous: (edit.previous as Record<string, unknown>) ?? {},
      current: (edit.current as Record<string, unknown>) ?? {},
    });
  }
  return out;
}
