// civic.input module — community input service
//
// Allows free-text submissions tied to a process_id.
// Input is stored independently from votes and is NOT used
// in vote tallying or lifecycle transitions.
//
// Storage: Postgres (community_inputs table).
//
// GUARDRAIL: This module MUST NOT import from civic.vote or any
// lifecycle/results code. Community input is a parallel data stream.

import { getDb } from "../../db/client.js";
import { generateId } from "../../utils/id.js";
import { assertPassesWordlist } from "../../shared/wordlist/index.js";
import type { CommunityInput, CommentModeration, CommentPhase, InputContext } from "./models.js";
import { BODY_PREVIEW_LEN, MODERATION_REASON_MAX } from "./models.js";

export type {
  CommunityInput,
  CommentModeration,
  CommentPhase,
  EmitEventFn,
  InputContext,
} from "./models.js";
export { MODERATION_REASON_MAX } from "./models.js";

interface InputRow {
  id: string;
  process_id: string;
  author_id: string | null;
  author_name: string | null;
  is_anonymous: boolean | null;
  body: string;
  submitted_at: string;
  phase: string | null;
  hidden_at: string | null;
  hidden_by: string | null;
  hidden_reason: string | null;
  restored_at: string | null;
}

function rowToInput(row: InputRow): CommunityInput {
  // The `hidden` flag is derived from the columns: a comment is hidden
  // iff hidden_at is set AND a later restored_at is not. Storing the
  // boolean explicitly in the DB would let it drift from the timestamps
  // — derivation keeps them consistent.
  let moderation: CommentModeration | null = null;
  if (row.hidden_at) {
    const restored = row.restored_at && row.restored_at >= row.hidden_at;
    moderation = {
      hidden: !restored,
      hidden_at: row.hidden_at,
      hidden_by: row.hidden_by,
      reason: row.hidden_reason,
      restored_at: row.restored_at,
    };
  }
  return {
    id: row.id,
    process_id: row.process_id,
    author_id: row.author_id ?? "",
    author_name: row.author_name ?? null,
    is_anonymous: row.is_anonymous ?? false,
    body: row.body,
    submitted_at: row.submitted_at,
    phase: (row.phase as CommentPhase) ?? null,
    moderation,
  };
}

/**
 * Submit community input for a process.
 *
 * Emits `civic.process.comment_added` on success, per Civic Event Spec §4.2
 * and Civic Process Spec §7.5 (participation actions MUST emit events).
 * The full body stays in the community_inputs table; the event only carries
 * an ID reference and a short body preview to keep event payloads small.
 *
 * The host hub injects its `emit` function through `ctx` so the module
 * stays portable — it never imports the hub's event system directly.
 */
export async function submitInput(
  process_id: string,
  author_id: string,
  body: string,
  ctx: InputContext,
  phase?: CommentPhase,
  identity?: {
    /** Display-level anonymity — author_id is still stored for moderation. */
    is_anonymous?: boolean;
    /** Real-name snapshot at post time; ignored when is_anonymous. */
    author_name?: string | null;
  },
): Promise<CommunityInput> {
  if (!body || body.trim().length === 0) {
    throw new Error("Input body cannot be empty");
  }

  // Egregious-slur pre-filter (see src/shared/wordlist). Blocks the obvious
  // case at submission; civil dissent passes through untouched.
  assertPassesWordlist(body);

  const id = generateId("input");
  const trimmed = body.trim();
  const isAnonymous = identity?.is_anonymous === true;
  const authorName = isAnonymous ? null : identity?.author_name ?? null;

  const { data, error } = await getDb()
    .from("community_inputs")
    .insert({
      id,
      process_id,
      author_id,
      body: trimmed,
      is_anonymous: isAnonymous,
      author_name: authorName,
    })
    .select()
    .single();

  if (error) throw new Error(`Input: ${error.message}`);

  // Phase is set in a separate update to tolerate PostgREST schema cache
  // lag after the column was added. Once the cache has refreshed this
  // could be inlined into the insert, but the two-step is harmless.
  if (phase) {
    await getDb()
      .from("community_inputs")
      .update({ phase })
      .eq("id", id);
  }

  const input = rowToInput(data as InputRow);
  input.phase = phase ?? null;

  // Emit the participation event. The preview is truncated so events stay
  // cheap to index and distribute; consumers that want the full body read
  // /process/:id/input. Anonymous comments emit actor "anonymous" — the
  // event log is public and permanent, so the author id must not appear
  // on it (the community_inputs row keeps it for moderation).
  await ctx.emit({
    event_type: "civic.process.comment_added",
    actor: isAnonymous ? "anonymous" : author_id,
    process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    data: {
      comment: {
        id: input.id,
        body_preview: trimmed.slice(0, BODY_PREVIEW_LEN),
        author_name: authorName,
        is_anonymous: isAnonymous,
      },
    },
  });

  return input;
}

/**
 * Get all community inputs for a process, oldest first.
 */
export async function getInputsByProcess(
  process_id: string,
): Promise<CommunityInput[]> {
  const { data, error } = await getDb()
    .from("community_inputs")
    .select("*")
    .eq("process_id", process_id)
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(`Input: ${error.message}`);
  return (data ?? []).map((r) => rowToInput(r as InputRow));
}


/**
 * Get a single community input by ID, including moderation state.
 * Returns undefined for unknown IDs. Slice 11 admin tooling uses this
 * to fetch the comment before applying a hide/restore decision.
 */
export async function getInputById(
  id: string,
): Promise<CommunityInput | undefined> {
  const { data, error } = await getDb()
    .from("community_inputs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Input: ${error.message}`);
  if (!data) return undefined;
  return rowToInput(data as InputRow);
}

/**
 * Slice 11 — admin moderation: hide a comment.
 *
 * Records the hide on the comment row (so future reads can redact the
 * body for the public) and emits a `civic.process.updated` event with
 * `meta.visibility = "restricted"` and `data.moderation` populated for
 * the audit trail. Public callers of /events never see the event;
 * admin callers do (gated in eventController).
 *
 * Idempotent: hiding an already-hidden comment is a no-op (returns the
 * current state without emitting a fresh event), so repeated clicks
 * don't pollute the audit log.
 */
export async function hideComment(
  comment_id: string,
  admin_id: string,
  reason: string,
  ctx: InputContext,
): Promise<CommunityInput> {
  const trimmedReason = (reason ?? "").trim();
  if (trimmedReason.length === 0) {
    throw new Error("A reason is required when hiding a comment.");
  }
  if (trimmedReason.length > MODERATION_REASON_MAX) {
    throw new Error(`Reason must be <= ${MODERATION_REASON_MAX} characters.`);
  }

  const existing = await getInputById(comment_id);
  if (!existing) throw new Error("Comment not found");
  if (existing.moderation?.hidden) return existing;

  const now = new Date().toISOString();
  const { data, error } = await getDb()
    .from("community_inputs")
    .update({
      hidden_at: now,
      hidden_by: admin_id,
      hidden_reason: trimmedReason,
      restored_at: null,
    })
    .eq("id", comment_id)
    .select()
    .single();
  if (error) throw new Error(`Input: ${error.message}`);
  const updated = rowToInput(data as InputRow);

  await ctx.emit({
    event_type: "civic.process.updated",
    actor: admin_id,
    process_id: existing.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    visibility: "restricted",
    data: {
      moderation: {
        action: "comment_hidden",
        target: {
          comment_id: existing.id,
          comment_author_id: existing.author_id,
        },
        reason: trimmedReason,
        hidden_by: admin_id,
      },
    },
  });

  return updated;
}

/**
 * Slice 11 — admin moderation: restore a previously hidden comment.
 * Records restored_at and emits a restricted-visibility event with
 * `action: "comment_restored"`. Idempotent: restoring an already-visible
 * comment is a no-op (no emit).
 */
export async function restoreComment(
  comment_id: string,
  admin_id: string,
  ctx: InputContext,
): Promise<CommunityInput> {
  const existing = await getInputById(comment_id);
  if (!existing) throw new Error("Comment not found");
  if (!existing.moderation?.hidden) return existing;

  const now = new Date().toISOString();
  const { data, error } = await getDb()
    .from("community_inputs")
    .update({ restored_at: now })
    .eq("id", comment_id)
    .select()
    .single();
  if (error) throw new Error(`Input: ${error.message}`);
  const updated = rowToInput(data as InputRow);

  await ctx.emit({
    event_type: "civic.process.updated",
    actor: admin_id,
    process_id: existing.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    visibility: "restricted",
    data: {
      moderation: {
        action: "comment_restored",
        target: {
          comment_id: existing.id,
          comment_author_id: existing.author_id,
        },
        reason: existing.moderation?.reason ?? null,
        restored_by: admin_id,
      },
    },
  });

  return updated;
}

/** Clear all inputs — dev/seed only. */
export async function clearInputs(): Promise<void> {
  const { error } = await getDb()
    .from("community_inputs")
    .delete()
    .neq("id", "");
  if (error) throw new Error(`Input: failed to clear: ${error.message}`);
}
