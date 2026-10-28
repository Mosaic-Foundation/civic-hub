// civic.proposals module — proposal intake and endorsement service
//
// Manages the lifecycle of user-submitted civic proposals:
//   submitted → endorsed → converted (or archived)
//
// Proposals are raw, unstructured ideas. They become structured
// civic.vote processes only after admin review and curation.
//
// Storage: the proposals and proposal_supports tables, through the module's
// store (store.ts, bound by the host).
//
// GUARDRAIL: This module MUST NOT import from civic.vote.
// The conversion to a vote is handled by the service/controller layer,
// which coordinates between this module and the vote module.

import { ConflictError, NotFoundError, ValidationError, generateId } from "@civic-social/plugin-sdk/first-party";
import { proposalsStore, type ProposalRow } from "./store.js";
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
  type EmitEventFn,
} from "./events.js";

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
    throw new ValidationError("Proposal title is required", "title_required");
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

  const data = await proposalsStore.get().insertProposal(row);

  const proposal = rowToProposal(data);

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
  const data = await proposalsStore.get().findProposal(id);
  if (!data) return undefined;
  return rowToProposal(data);
}

/**
 * Whether a proposal row with this id exists (a cheaper check than
 * getProposal, for callers that only need to know).
 */
export async function proposalExists(id: string): Promise<boolean> {
  return proposalsStore.get().proposalExists(id);
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
  const data = await proposalsStore.get().listProposals(statusFilter);
  return data.map(rowToProposal);
}

/**
 * List proposals needing admin review (endorsed).
 * Most supported first, then most recent.
 */
export async function listEndorsedProposals(): Promise<Proposal[]> {
  const data = await proposalsStore.get().listEndorsed();
  return data.map(rowToProposal);
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
  // Load current proposal and validate state.
  const proposal = await getProposal(proposalId);
  if (!proposal) {
    throw new NotFoundError("Proposal not found", "proposal_not_found");
  }
  if (proposal.status !== "submitted") {
    throw new ConflictError(
      "This proposal is no longer accepting support.",
      "proposal_not_open",
    );
  }

  // Insert support — composite PK catches duplicates atomically.
  const inserted = await proposalsStore.get().insertSupport(proposalId, userId);
  if (inserted === "duplicate") {
    throw new ConflictError("You have already supported this proposal", "already_supported");
  }

  // Recount from the authoritative source (the supports table).
  const newCount = await proposalsStore.get().countSupports(proposalId);

  // Update the proposal row with the new count. Status stays unchanged —
  // Slice B removed the auto-promotion to "endorsed" when crossing the
  // support threshold. Proposals remain in "submitted" status regardless
  // of support count.
  const updated = await proposalsStore.get().setSupportCount(proposalId, newCount);

  const result = rowToProposal(updated);

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
  const proposal = await getProposal(proposalId);
  if (!proposal) {
    throw new NotFoundError("Proposal not found", "proposal_not_found");
  }
  if (proposal.status !== "submitted") {
    throw new ConflictError(
      "Support can no longer be withdrawn: this proposal has closed and its support is part of the record.",
      "support_locked",
    );
  }

  const removed = await proposalsStore.get().deleteSupport(proposalId, userId);
  if (!removed) {
    throw new ConflictError("You haven't supported this proposal", "not_supported");
  }

  const newCount = await proposalsStore.get().countSupports(proposalId);

  const updated = await proposalsStore.get().setSupportCount(proposalId, newCount);

  const result = rowToProposal(updated);

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
  const count = await proposalsStore.get().countSupports(proposalId, userId);
  return count > 0;
}


// --- Status transitions ----------------------------------------------------
//
// A proposal's status changes through executeAction (src/processes/
// proposalAdapter.ts): the processes row is the record, written with its
// events in one transaction. The proposals row keeps a copy for its read
// model, written here after that transaction commits.

/** Copy a committed close onto the proposals row (only an open one). */
export async function markProposalClosed(proposalId: string): Promise<void> {
  await proposalsStore.get().closeIfSubmitted(proposalId);
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
  await proposalsStore.get().deleteAll();
}
