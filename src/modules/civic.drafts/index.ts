// One draft store for every drafting kind (Audit 3, F1). Before this,
// civic.proposal_drafts, vote_drafts, project_drafts and deliberation_drafts
// were four copies of the same module that had drifted apart (only proposals
// claimed a draft atomically on submit). Each kind is now a DraftSpec: its
// table, id prefix and its own fields; the base fields and every operation
// are here, once.
//
// Each kind keeps its own table (no data moved). Rows are read and written
// through forHub(), so a draft is only ever seen inside its hub.

import { NotFoundError } from "../../errors/index.js";
import { forHub, type HubDb } from "../../db/forHub.js";
import { currentHubId } from "../../config/hubContext.js";
import { generateId } from "../../utils/id.js";
import type { Suggestion } from "../civic.assistant/models.js";
import {
  BASE_CHECKED_FIELDS,
  type BaseDraft,
  type Draft,
  type DraftSpec,
  type DraftStatus,
  type ProposedLink,
} from "./models.js";

export * from "./models.js";

function db(): HubDb {
  return forHub(currentHubId());
}

type Row = Record<string, unknown>;

/** A row of the kind's table as a draft: base fields defaulted, the kind's read through its spec. */
export function rowToDraft<E extends object = Record<string, unknown>>(spec: DraftSpec, row: Row): Draft<E> {
  const base: BaseDraft = {
    id: String(row.id),
    user_id: String(row.user_id),
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    // "" for rows (or databases) from before a kind had the column.
    sources: (row.sources as string | null) ?? "",
    conversation_history: Array.isArray(row.conversation_history)
      ? (row.conversation_history as BaseDraft["conversation_history"])
      : [],
    last_review_result: Array.isArray(row.last_review_result)
      ? (row.last_review_result as Suggestion[])
      : null,
    draft_modified_since_review: row.draft_modified_since_review === true,
    coc_checked_hash: (row.coc_checked_hash as string | null) ?? null,
    assistant_helped: row.assistant_helped === true,
    links: Array.isArray(row.links) ? (row.links as ProposedLink[]) : [],
    status: row.status as DraftStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
  const extra: Row = {};
  for (const [name, field] of Object.entries(spec.fields)) {
    extra[name] = field.read ? field.read(row[name]) : row[name];
  }
  return { ...base, ...extra } as Draft<E>;
}

export async function createDraft<E extends object>(
  spec: DraftSpec,
  userId: string,
  input: Record<string, unknown> = {},
): Promise<Draft<E>> {
  const row = await db()
    .from(spec.table)
    .insert({
      id: generateId(spec.idPrefix),
      user_id: userId,
      ...(spec.createDefaults ? spec.createDefaults(input) : {}),
    })
    .select<Row>()
    .single();
  return rowToDraft<E>(spec, row);
}

export async function getDraft<E extends object>(spec: DraftSpec, id: string): Promise<Draft<E> | undefined> {
  const row = await db().from(spec.table).select<Row>("*").eq("id", id).maybeSingle();
  return row ? rowToDraft<E>(spec, row) : undefined;
}

export async function listUserDrafts<E extends object>(
  spec: DraftSpec,
  userId: string,
  status?: DraftStatus,
): Promise<Draft<E>[]> {
  let q = db().from(spec.table).select<Row>("*").eq("user_id", userId).order("updated_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const rows = await q;
  return rows.map((r) => rowToDraft<E>(spec, r));
}

/** A PATCH: the base text fields, links, and the kind's writable fields. */
export interface DraftPatch {
  title?: unknown;
  description?: unknown;
  sources?: unknown;
  links?: ProposedLink[];
  /** The value being written is assistant-produced text (Apply on a
   *  suggestion card) — sets assistant_helped on the draft. */
  assistant_applied?: boolean;
  [field: string]: unknown;
}

/**
 * Apply a PATCH. A kind's field is written only when its spec says how
 * (`write`), which also checks it (an Error refuses the whole patch). A
 * change to a field the Code of Conduct check reads marks the draft modified;
 * decided here, never by the client. That flag is what the form shows; the
 * submit gate compares the check's hash (services/codeOfConduct.ts) either way.
 */
export async function updateDraft<E extends object>(spec: DraftSpec, id: string, patch: DraftPatch): Promise<Draft<E>> {
  const updates: Row = {};
  for (const name of BASE_CHECKED_FIELDS) {
    if (patch[name] !== undefined) updates[name] = patch[name];
  }
  for (const [name, field] of Object.entries(spec.fields)) {
    if (patch[name] !== undefined && field.write) updates[name] = field.write(patch[name]);
  }
  if (patch.links !== undefined) updates.links = patch.links;

  // assistant_applied: the caller is writing assistant-produced text into
  // the form (Apply on a suggestion card). This — not conversation — is what
  // flips the public "drafted with assistant help" disclosure.
  if (patch.assistant_applied) updates.assistant_helped = true;

  const checked = [
    ...BASE_CHECKED_FIELDS,
    ...Object.entries(spec.fields).filter(([, f]) => f.checked).map(([n]) => n),
  ];
  if (checked.some((k) => k in updates)) updates.draft_modified_since_review = true;

  const row = await db().from(spec.table).update(updates).eq("id", id).select<Row>().single();
  return rowToDraft<E>(spec, row);
}

export async function appendConversation(
  spec: DraftSpec,
  id: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  const draft = await getDraft(spec, id);
  if (!draft) throw new NotFoundError("Draft not found");
  const history = [
    ...draft.conversation_history,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: assistantMessage },
  ];
  // Talking to the assistant does NOT flag the draft as AI-helped: the
  // disclosure fires only when assistant-produced text lands in the form
  // (applyGeneratedDraft, or updateDraft with assistant_applied).
  await db().from(spec.table).update({ conversation_history: history }).eq("id", id);
}

export async function saveReviewResult(
  spec: DraftSpec,
  id: string,
  suggestions: Suggestion[],
  checkedHash: string | null,
): Promise<void> {
  await db()
    .from(spec.table)
    .update({
      last_review_result: suggestions,
      draft_modified_since_review: false,
      coc_checked_hash: checkedHash,
    })
    .eq("id", id);
}

/** An assistant-generated first draft: title, description, sources and the kind's generated fields. */
export async function applyGeneratedDraft<E extends object>(
  spec: DraftSpec,
  id: string,
  generated: Record<string, string | undefined>,
): Promise<Draft<E>> {
  const updates: Row = {
    title: generated.title ?? "",
    description: generated.description ?? "",
    sources: generated.sources ?? "",
    assistant_helped: true,
  };
  for (const name of spec.generatedFields ?? []) updates[name] = generated[name] ?? "";
  const row = await db().from(spec.table).update(updates).eq("id", id).select<Row>().single();
  return rowToDraft<E>(spec, row);
}

export async function setDraftStatus(spec: DraftSpec, id: string, status: DraftStatus): Promise<void> {
  await db().from(spec.table).update({ status }).eq("id", id);
}

/**
 * Atomically claim a draft for submission: flip drafting → submitted only if
 * it is still "drafting". True when this call won; false when a concurrent or
 * repeated submit already had it (a double click, two tabs). The conditional
 * WHERE is the single source of truth against double submission.
 */
export async function claimDraftForSubmission(spec: DraftSpec, id: string): Promise<boolean> {
  const rows = await db()
    .from(spec.table)
    .update({ status: "submitted" as DraftStatus })
    .eq("id", id)
    .eq("status", "drafting")
    .select<{ id: string }>("id");
  return rows.length > 0;
}
