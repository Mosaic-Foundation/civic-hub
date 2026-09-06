// civic.proposals module — proposal intake and endorsement service
//
// Manages the lifecycle of user-submitted civic proposals:
//   submitted → endorsed → converted (or archived)
//
// Proposals are raw, unstructured ideas. They become structured
// civic.vote processes only after admin review and curation.
//
// Storage: Postgres (proposals, proposal_supports tables).
//
// GUARDRAIL: This module MUST NOT import from civic.vote.
// The conversion to a vote is handled by the service/controller layer,
// which coordinates between this module and the vote module.

import { getDb } from "../../db/client.js";
import { generateId } from "../../utils/id.js";
import type {
  Proposal,
  ProposalSupport,
  ProposalStatus,
  CreateProposalInput,
  ProposalConfig,
} from "./models.js";
import {
  emitProposalSubmitted,
  emitProposalSupported,
  emitProposalSupportWithdrawn,
  emitProposalClosed,
  type EmitEventFn,
} from "./events.js";
import { isPastDeadline } from "../../utils/deadline.js";

export type {
  Proposal,
  ProposalSupport,
  ProposalStatus,
  CreateProposalInput,
  ProposalConfig,
} from "./models.js";
export { DEFAULT_PROPOSAL_CONFIG } from "./models.js";

// --- Configuration ---------------------------------------------------------

let config: ProposalConfig = { proposal_support_threshold: 5 };

export function setProposalConfig(c: ProposalConfig): void {
  config = c;
}

export function getProposalConfig(): ProposalConfig {
  return { ...config };
}

// --- Row <-> model mapping -------------------------------------------------

interface ProposalRow {
  id: string;
  title: string;
  description: string | null;
  links: string[] | null;
  status: ProposalStatus;
  support_count: number;
  submitted_by: string | null;
  converted_to_process_id: string | null;
  category?: string | null;
  assistant_helped?: boolean;
  closes_at?: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    optional_links: row.links ?? [],
    submitted_by: row.submitted_by ?? "",
    status: row.status,
    support_count: row.support_count,
    category: row.category ?? null,
    assistant_helped: row.assistant_helped ?? false,
    closes_at: row.closes_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// --- Proposal CRUD ---------------------------------------------------------

/**
 * Create a new proposal from user submission.
 */
export async function createProposal(
  input: CreateProposalInput,
  emit: EmitEventFn,
): Promise<Proposal> {
  if (!input.title || input.title.trim().length === 0) {
    throw new Error("Proposal title is required");
  }

  const id = input.id ?? generateId("prop");
  const links = (input.optional_links ?? []).filter((l) => l.trim().length > 0);

  const row: Record<string, unknown> = {
    id,
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    links,
    status: "submitted" as ProposalStatus,
    support_count: 0,
    submitted_by: input.submitted_by,
  };
  if (input.category !== undefined) row.category = input.category;
  if (input.assistant_helped !== undefined) row.assistant_helped = input.assistant_helped;
  if (input.closes_at !== undefined) row.closes_at = input.closes_at;

  const { data, error } = await getDb()
    .from("proposals")
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new Error(`Proposals: failed to create: ${error.message}`);
  }

  const proposal = rowToProposal(data as ProposalRow);

  console.log(
    `[proposal] created "${proposal.title}" (${id}) by ${proposal.submitted_by}`,
  );

  await emitProposalSubmitted(
    { proposal_id: id, emit },
    input.submitted_by,
    { title: proposal.title },
  );

  return proposal;
}

/**
 * Get a proposal by ID.
 */
export async function getProposal(id: string): Promise<Proposal | undefined> {
  const { data, error } = await getDb()
    .from("proposals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Proposals: ${error.message}`);
  if (!data) return undefined;
  return rowToProposal(data as ProposalRow);
}

/**
 * List proposals, newest first.
 *
 * ARCHIVED PROPOSALS ARE EXCLUDED unless `statusFilter` asks for them by name.
 * The public list previously returned every status, so an archived proposal
 * stayed on /propose after an admin took it down. Callers that genuinely want
 * archived rows pass statusFilter: "archived".
 */
export async function listProposals(
  statusFilter?: ProposalStatus,
): Promise<Proposal[]> {
  let query = getDb()
    .from("proposals")
    .select("*")
    .order("created_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  } else {
    // Default-exclude archived. See the note above: an unfiltered list is the
    // PUBLIC list, and an archived proposal must not appear on it.
    query = query.neq("status", "archived");
  }

  const { data, error } = await query;
  if (error) throw new Error(`Proposals: ${error.message}`);
  return (data ?? []).map((r) => rowToProposal(r as ProposalRow));
}

/**
 * List proposals needing admin review (endorsed).
 * Most supported first, then most recent.
 */
export async function listEndorsedProposals(): Promise<Proposal[]> {
  const { data, error } = await getDb()
    .from("proposals")
    .select("*")
    .eq("status", "endorsed")
    .order("support_count", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Proposals: ${error.message}`);
  return (data ?? []).map((r) => rowToProposal(r as ProposalRow));
}

// --- Support / Endorsement -------------------------------------------------

/**
 * Add support from a user. If the endorsement threshold is reached,
 * transitions the proposal to "endorsed".
 *
 * Race-safe: composite primary key on proposal_supports rejects duplicate
 * (proposal_id, user_id) pairs atomically. support_count is reconciled
 * from the authoritative count in the supports table.
 */
export async function supportProposal(
  proposalId: string,
  userId: string,
  emit: EmitEventFn,
): Promise<Proposal> {
  const db = getDb();

  // Load current proposal and validate state.
  const proposal = await getProposal(proposalId);
  if (!proposal) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  if (proposal.status !== "submitted") {
    throw new Error(
      `Cannot support proposal: proposal is in "${proposal.status}" state. ` +
      `Only proposals in "submitted" state accept endorsements.`,
    );
  }

  // Insert support — composite PK catches duplicates atomically.
  const { error: supErr } = await db.from("proposal_supports").insert({
    proposal_id: proposalId,
    user_id: userId,
  });

  if (supErr) {
    if (supErr.code === "23505") {
      throw new Error("You have already supported this proposal");
    }
    throw new Error(`Proposals: ${supErr.message}`);
  }

  // Recount from the authoritative source (the supports table).
  const { count: supportCount, error: countErr } = await db
    .from("proposal_supports")
    .select("*", { count: "exact", head: true })
    .eq("proposal_id", proposalId);
  if (countErr) throw new Error(`Proposals: ${countErr.message}`);
  const newCount = supportCount ?? 0;

  // Update the proposal row with the new count. Status stays unchanged —
  // Slice B removed the auto-promotion to "endorsed" when crossing the
  // support threshold. Proposals remain in "submitted" status regardless
  // of support count.
  const { data: updated, error: updErr } = await db
    .from("proposals")
    .update({
      support_count: newCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", proposalId)
    .select()
    .single();
  if (updErr) throw new Error(`Proposals: ${updErr.message}`);

  const result = rowToProposal(updated as ProposalRow);

  await emitProposalSupported(
    { proposal_id: proposalId, emit },
    userId,
    {
      support_count: result.support_count,
      support_threshold: config.proposal_support_threshold,
    },
  );

  return result;
}

/**
 * Withdraw a user's support. Allowed for as long as the proposal is open
 * (`submitted`); once it has closed and gone to its brief the count is part
 * of the record and stays (Adam, 2026-09-06). Same recount-from-the-table
 * discipline as supportProposal, so the two can never disagree.
 */
export async function withdrawProposalSupport(
  proposalId: string,
  userId: string,
  emit: EmitEventFn,
): Promise<Proposal> {
  const db = getDb();

  const proposal = await getProposal(proposalId);
  if (!proposal) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  if (proposal.status !== "submitted") {
    throw new Error(
      "Support can no longer be withdrawn: this proposal has closed and its support is part of the record.",
    );
  }

  const { data: removed, error: delErr } = await db
    .from("proposal_supports")
    .delete()
    .eq("proposal_id", proposalId)
    .eq("user_id", userId)
    .select();
  if (delErr) throw new Error(`Proposals: ${delErr.message}`);
  if (!removed || removed.length === 0) {
    throw new Error("You haven't supported this proposal");
  }

  const { count: supportCount, error: countErr } = await db
    .from("proposal_supports")
    .select("*", { count: "exact", head: true })
    .eq("proposal_id", proposalId);
  if (countErr) throw new Error(`Proposals: ${countErr.message}`);
  const newCount = supportCount ?? 0;

  const { data: updated, error: updErr } = await db
    .from("proposals")
    .update({
      support_count: newCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", proposalId)
    .select()
    .single();
  if (updErr) throw new Error(`Proposals: ${updErr.message}`);

  const result = rowToProposal(updated as ProposalRow);

  await emitProposalSupportWithdrawn(
    { proposal_id: proposalId, emit },
    userId,
    {
      support_count: result.support_count,
      support_threshold: config.proposal_support_threshold,
    },
  );

  return result;
}

/**
 * Check if a user has supported a proposal.
 */
export async function hasUserSupported(
  proposalId: string,
  userId: string,
): Promise<boolean> {
  const { count, error } = await getDb()
    .from("proposal_supports")
    .select("*", { count: "exact", head: true })
    .eq("proposal_id", proposalId)
    .eq("user_id", userId);
  if (error) throw new Error(`Proposals: ${error.message}`);
  return (count ?? 0) > 0;
}


// --- Status transitions ----------------------------------------------------

/**
 * Archive a proposal (admin action — reject or shelve).
 *
 * Flips BOTH the child `proposals` row and the canonical `processes` row to
 * "archived" so the two stay in lockstep — otherwise an archived proposal would
 * still surface in the unified read layer (getAllProcesses filters on the
 * processes-row status, not the child row).
 */
export async function archiveProposal(proposalId: string): Promise<void> {
  const proposal = await getProposal(proposalId);
  if (!proposal) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  if (proposal.status === "converted") {
    throw new Error("Cannot archive a converted proposal");
  }

  const now = new Date().toISOString();
  const { error } = await getDb()
    .from("proposals")
    .update({
      status: "archived" as ProposalStatus,
      updated_at: now,
    })
    .eq("id", proposalId);
  if (error) throw new Error(`Proposals: ${error.message}`);

  // Keep the canonical processes row in sync (no-op for any legacy proposal
  // that predates the unified processes row).
  const { error: procErr } = await getDb()
    .from("processes")
    .update({ status: "archived", updated_at: now })
    .eq("id", proposalId);
  if (procErr) throw new Error(`Proposals: failed to archive process row: ${procErr.message}`);
}

/**
 * Lazy deadline-close for a proposal. If the proposal is still open
 * ("submitted") and its closes_at has elapsed (guarded against malformed
 * timestamps), transition it to the terminal "closed" status, sync the
 * canonical processes row, and emit a lifecycle event.
 *
 * Idempotent and safe to call on every read: a proposal not in "submitted",
 * with no/future/invalid deadline, returns `false` and changes nothing.
 * Returns `true` iff it actually closed the proposal.
 */
export async function closeExpiredProposal(
  proposalId: string,
  emit: EmitEventFn,
): Promise<boolean> {
  const proposal = await getProposal(proposalId);
  if (!proposal) return false;
  // Only an open proposal closes. "closed"/"archived"/legacy states are no-ops.
  if (proposal.status !== "submitted") return false;
  if (!isPastDeadline(proposal.closes_at)) return false;

  const now = new Date().toISOString();
  // Atomic claim: close only if still "submitted". Two concurrent lazy-close
  // reads previously both passed the status check above and both updated +
  // emitted, producing duplicate civic.proposal.closed events. The conditional
  // update means only one wins the row; the loser gets an empty result.
  const { data: claimed, error } = await getDb()
    .from("proposals")
    .update({ status: "closed" as ProposalStatus, updated_at: now })
    .eq("id", proposalId)
    .eq("status", "submitted")
    .select("id");
  if (error) throw new Error(`Proposals: failed to close: ${error.message}`);
  if (!claimed || claimed.length === 0) return false; // lost the race — no-op

  // Keep the canonical processes row in sync (source of truth for the unified
  // read layer). No-op for any legacy proposal without a processes row.
  const { error: procErr } = await getDb()
    .from("processes")
    .update({ status: "closed", updated_at: now })
    .eq("id", proposalId);
  if (procErr) throw new Error(`Proposals: failed to close process row: ${procErr.message}`);

  console.log(`[auto-close] Proposal ${proposalId} past deadline ${proposal.closes_at}, closed.`);

  await emitProposalClosed(
    { proposal_id: proposalId, emit },
    "system:auto-close",
    { support_count: proposal.support_count },
  );

  return true;
}

// --- Read models -----------------------------------------------------------

/**
 * Get a UI-friendly read model for a proposal. If `actor` is provided,
 * includes whether that actor has supported.
 */
export async function getProposalReadModel(
  proposalId: string,
  actor?: string,
): Promise<Record<string, unknown> | undefined> {
  const proposal = await getProposal(proposalId);

  // An ARCHIVED proposal is not public. Archiving is the admin's take-down for
  // content that should not be up, and it already removes the proposal from
  // the generic process list and the feed — but this read model backs
  // /proposals/:id, which was still serving it at its direct URL. A take-down
  // that leaves the link working is not a take-down.
  //
  // Admin surfaces do not come through here: the Archived tab reads
  // processService.getArchivedProcesses.
  // `undefined` is this function's existing "not found" signal, and the
  // controller already turns it into a 404 — so an archived proposal returns
  // the same thing rather than introducing a second absent-value.
  if (proposal && proposal.status === "archived") return undefined;
  if (!proposal) return undefined;

  const hasSupported = actor ? await hasUserSupported(proposalId, actor) : null;

  return {
    id: proposal.id,
    title: proposal.title,
    description: proposal.description,
    optional_links: proposal.optional_links,
    submitted_by: proposal.submitted_by,
    status: proposal.status,
    support_count: proposal.support_count,
    support_threshold: config.proposal_support_threshold,
    has_supported: hasSupported,
    category: proposal.category,
    assistant_helped: proposal.assistant_helped,
    closes_at: proposal.closes_at,
    created_at: proposal.created_at,
    updated_at: proposal.updated_at,
  };
}

/**
 * Summary for list views. Takes an already-loaded Proposal.
 */
export function getProposalSummary(proposal: Proposal): Record<string, unknown> {
  return {
    id: proposal.id,
    title: proposal.title,
    description: proposal.description,
    submitted_by: proposal.submitted_by,
    status: proposal.status,
    support_count: proposal.support_count,
    support_threshold: config.proposal_support_threshold,
    category: proposal.category,
    assistant_helped: proposal.assistant_helped,
    closes_at: proposal.closes_at,
    created_at: proposal.created_at,
  };
}

// --- Dev/test utilities ----------------------------------------------------

/** Clear all proposals — dev/seed only. ON DELETE CASCADE removes supports. */
export async function clearProposals(): Promise<void> {
  const db = getDb();
  // Explicit delete of supports first (belt-and-suspenders; FK cascade would
  // handle it, but being explicit avoids any surprise if FK is modified).
  await db.from("proposal_supports").delete().neq("proposal_id", "");
  const { error } = await db.from("proposals").delete().neq("id", "");
  if (error) throw new Error(`Proposals: failed to clear: ${error.message}`);
}
