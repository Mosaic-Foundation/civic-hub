// What civic.proposals keeps, as the host supplies it (ADR-012, the database
// convention): the module never imports src/db/. The implementation is
// src/stores/proposals.ts, bound at startup by installStores(). The tables are
// `proposals` and `proposal_supports`.

import { storeSlot } from "../../processes/storeSlot.js";
import type { ProposalStatus } from "./models.js";

/** A stored proposal, as the `proposals` table has it. */
export interface ProposalRow {
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

export interface ProposalsStore {
  /** Store one proposal (the columns the caller sets) and return the row. */
  insertProposal(row: Record<string, unknown>): Promise<ProposalRow>;
  /** One proposal by id, or null. */
  findProposal(id: string): Promise<ProposalRow | null>;
  /** Whether a proposal row with this id exists. */
  proposalExists(id: string): Promise<boolean>;
  /** Newest first (paged past 1,000): one status, or every status but archived. */
  listProposals(status?: ProposalStatus): Promise<ProposalRow[]>;
  /** The endorsed ones, most supported first then newest (paged past 1,000). */
  listEndorsed(): Promise<ProposalRow[]>;
  /** Record one person's support. "duplicate": they already supported it (the composite key). */
  insertSupport(proposalId: string, userId: string): Promise<"ok" | "duplicate">;
  /** Remove one person's support; whether there was any to remove. */
  deleteSupport(proposalId: string, userId: string): Promise<boolean>;
  /** The supports on a proposal, or by one person when `userId` is given. */
  countSupports(proposalId: string, userId?: string): Promise<number>;
  /** Write the reconciled support count (and the update time); returns the row. */
  setSupportCount(proposalId: string, count: number): Promise<ProposalRow>;
  /** A proposal's status as stored, or undefined when there is no row. */
  statusOf(proposalId: string): Promise<string | undefined>;
  /** Set a proposal's status (and the update time). */
  setStatus(proposalId: string, status: string): Promise<void>;
  /** Close a proposal, only if it is still submitted. */
  closeIfSubmitted(proposalId: string): Promise<void>;
  /** Development seed only: every proposal and support on the hub. */
  deleteAll(): Promise<void>;
}

export const proposalsStore = storeSlot<ProposalsStore>("civic.proposals");
