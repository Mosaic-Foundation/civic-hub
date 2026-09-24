// civic.vote module — type definitions
//
// These types are self-contained. The module makes no assumptions
// about the host hub's ORM, schema, or storage layer.

export type VoteStatus =
  | "draft"
  | "proposed"
  | "threshold_met"
  | "active"
  | "closed"
  | "finalized";

export interface VoteConfig {
  jurisdiction: string;
  support_threshold: number;
  voting_duration_ms: number;
  activation_mode: "direct" | "proposal_required";
}

export interface VoteResult {
  tally: Record<string, number>;
  total_votes: number;
  computed_at: string;
}

export interface VoteProcessState {
  type: "civic.vote";
  method: string; // "yes_no_unsure" | "approval" (extensible)
  status: VoteStatus;
  options: string[];
  // Ballot secrecy: individual ballots are NEVER stored in process state.
  // They live in the civic.receipts tables (vote_records, keyed by random
  // receipt_id with no user link). State keeps only the anonymous count.
  total_votes: number;
  supporters: Record<string, boolean>; // actor → supported (endorsements are not secret)
  support_count: number;
  config: {
    support_threshold: number;
    voting_duration_ms: number;
    activation_mode: "direct" | "proposal_required";
  };
  voting_opens_at: string | null;
  voting_closes_at: string | null;
  result: VoteResult | null;
}

/**
 * Event emission callback — injected by the host hub.
 * The module never imports the hub's event system directly.
 *
 * Returns a Promise so the host hub can durably store the event before
 * the caller proceeds. Modules should always `await` emissions.
 */
export interface EmitEventFn {
  (input: {
    event_type: string;
    actor: string;
    process_id: string;
    jurisdiction: string;
    data: Record<string, unknown>;
    /** Phase 3 — canonical process type, stamped into data.process.type. */
    processType?: string;
    /**
     * Ballot secrecy — vote_submitted events are emitted with restricted
     * visibility so the public /events feed never links an actor to a
     * ballot. Defaults to "public" when omitted.
     */
    visibility?: "public" | "restricted";
  }): Promise<unknown>;
}

/** Result returned by every module action */
export interface ActionOutcome {
  state: VoteProcessState;
  result: Record<string, unknown>;
}
