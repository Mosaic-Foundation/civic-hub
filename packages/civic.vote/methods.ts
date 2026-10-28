// civic.vote module — pluggable voting method sub-registry
//
// Each VotingMethod encapsulates the ballot shape, validation, tally
// computation, and receipt serialization for one voting algorithm.
// The rest of the vote lifecycle (draft/proposed/active/closed/finalized),
// receipt privacy model, event emission, and vote-results pipeline are
// shared across all methods.
//
// To add a new method (e.g. ranked-choice):
//   1. Implement VotingMethod
//   2. Register it in VOTING_METHODS below
//   3. No other file changes needed

import { ValidationError } from "@civic-social/plugin-sdk/first-party";
import type { VoteResult } from "./models.js";

// --- Interface ---------------------------------------------------------------

export type Ballot = string | string[];

export interface VotingMethod {
  key: string;

  /** Default options when none are provided at creation (null = creator must supply them) */
  defaultOptions: string[] | null;

  /** Minimum number of options required (enforced at creation) */
  minOptions: number;

  /** Validate raw ballot input; return normalized form or throw */
  validateBallot(input: unknown, options: string[]): Ballot;

  /** Is this a no-op re-submission of the same ballot? */
  isSameBallot(existing: Ballot, incoming: Ballot): boolean;

  /** Serialize ballot for the receipt system's TEXT choice column */
  serializeForReceipt(ballot: Ballot): string;

  /** Deserialize a receipt choice back to displayable form */
  deserializeReceipt(choice: string): string;

  /** Parse a receipt's TEXT choice column back into a Ballot */
  parseReceipt(choice: string): Ballot;

  /** Compute tally from anonymized ballots (order-free, no voter linkage) */
  computeTally(
    ballots: Ballot[],
    options: string[],
  ): VoteResult;

  /** Human-readable label for the aggregation event summary */
  summarizeTally(result: VoteResult): string;
}

// --- yes_no_unsure -----------------------------------------------------------

const yesNoUnsure: VotingMethod = {
  key: "yes_no_unsure",
  defaultOptions: ["yes", "no", "unsure"],
  minOptions: 2,

  validateBallot(input: unknown, options: string[]): string {
    if (typeof input !== "string" || !input) {
      throw new ValidationError("Choose an option to vote.", "option_required");
    }
    if (!options.includes(input)) {
      throw new ValidationError(
        `Invalid option "${input}". Valid options: ${options.join(", ")}`,
      );
    }
    return input;
  },

  isSameBallot(existing: Ballot, incoming: Ballot): boolean {
    return existing === incoming;
  },

  serializeForReceipt(ballot: Ballot): string {
    return ballot as string;
  },

  deserializeReceipt(choice: string): string {
    return choice;
  },

  parseReceipt(choice: string): Ballot {
    return choice;
  },

  computeTally(
    ballots: Ballot[],
    options: string[],
  ): VoteResult {
    const tally: Record<string, number> = {};
    for (const option of options) {
      tally[option] = 0;
    }
    for (const ballot of ballots) {
      const option = ballot as string;
      if (tally[option] !== undefined) {
        tally[option]++;
      }
    }
    return {
      tally,
      total_votes: ballots.length,
      computed_at: new Date().toISOString(),
    };
  },

  summarizeTally(result: VoteResult): string {
    const entries = Object.entries(result.tally).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0 || result.total_votes === 0) {
      return "No votes recorded.";
    }
    const [topOption, topCount] = entries[0];
    const pct = Math.round((topCount / result.total_votes) * 100);
    return `${topOption}: ${topCount} of ${result.total_votes} (${pct}%)`;
  },
};

// --- approval ----------------------------------------------------------------

const approval: VotingMethod = {
  key: "approval",
  defaultOptions: null,
  minOptions: 2,

  validateBallot(input: unknown, options: string[]): string[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw new ValidationError(
        "Approval voting requires payload.selections (a non-empty array of approved options)",
      );
    }
    const selections = input as string[];
    for (const s of selections) {
      if (typeof s !== "string") {
        throw new ValidationError("Each selection must be a string");
      }
      if (!options.includes(s)) {
        throw new ValidationError(
          `Invalid selection "${s}". Valid options: ${options.join(", ")}`,
        );
      }
    }
    // Deduplicate
    const unique = [...new Set(selections)];
    return unique;
  },

  isSameBallot(existing: Ballot, incoming: Ballot): boolean {
    const a = (existing as string[]).slice().sort();
    const b = (incoming as string[]).slice().sort();
    return a.length === b.length && a.every((v, i) => v === b[i]);
  },

  serializeForReceipt(ballot: Ballot): string {
    return JSON.stringify(ballot);
  },

  deserializeReceipt(choice: string): string {
    try {
      const parsed = JSON.parse(choice);
      if (Array.isArray(parsed)) {
        return parsed.join(", ");
      }
    } catch {
      // fall through
    }
    return choice;
  },

  parseReceipt(choice: string): Ballot {
    try {
      const parsed = JSON.parse(choice);
      if (Array.isArray(parsed)) {
        return parsed.filter((s): s is string => typeof s === "string");
      }
    } catch {
      // fall through
    }
    // Malformed row — count nothing rather than guessing.
    return [];
  },

  computeTally(
    ballots: Ballot[],
    options: string[],
  ): VoteResult {
    const tally: Record<string, number> = {};
    for (const option of options) {
      tally[option] = 0;
    }
    for (const ballot of ballots) {
      for (const option of ballot as string[]) {
        if (tally[option] !== undefined) {
          tally[option]++;
        }
      }
    }
    return {
      tally,
      total_votes: ballots.length,
      computed_at: new Date().toISOString(),
    };
  },

  summarizeTally(result: VoteResult): string {
    const entries = Object.entries(result.tally).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0 || result.total_votes === 0) {
      return "No votes recorded.";
    }
    const [topOption, topCount] = entries[0];
    const pct = Math.round((topCount / result.total_votes) * 100);
    return `Most approved: ${topOption} (${topCount} of ${result.total_votes} voters, ${pct}%)`;
  },
};

// --- Registry ----------------------------------------------------------------

const VOTING_METHODS: Record<string, VotingMethod> = {
  yes_no_unsure: yesNoUnsure,
  approval,
};

export const DEFAULT_METHOD = "yes_no_unsure";

export function getVotingMethod(key: string): VotingMethod {
  const method = VOTING_METHODS[key];
  if (!method) {
    throw new ValidationError(
      `Unknown voting method "${key}". Available: ${Object.keys(VOTING_METHODS).join(", ")}`,
    );
  }
  return method;
}

export function getAvailableMethods(): string[] {
  return Object.keys(VOTING_METHODS);
}
