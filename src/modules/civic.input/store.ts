// What civic.input keeps, as the host supplies it (ADR-012, the database
// convention): the module never imports src/db/. The implementation is
// src/stores/input.ts, bound at startup by installStores().

import { storeSlot } from "../../processes/storeSlot.js";

/** A stored comment, as the `community_inputs` table has it. */
export interface InputRow {
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

/** The columns a new comment sets (phase only when there is one). */
export interface NewInput {
  id: string;
  process_id: string;
  author_id: string;
  body: string;
  is_anonymous: boolean;
  author_name: string | null;
  phase?: string;
}

export interface InputStore {
  /** Store one comment and return the row. */
  insertInput(row: NewInput): Promise<InputRow>;
  /** Every comment on a process, oldest first (paged past 1,000). */
  inputsForProcess(processId: string): Promise<InputRow[]>;
  /** One comment by id, or null. */
  findInput(id: string): Promise<InputRow | null>;
  /** Record a hide on a comment and return the row. */
  markHidden(id: string, hide: { hiddenAt: string; hiddenBy: string; reason: string }): Promise<InputRow>;
  /** Record a restore on a comment and return the row. */
  markRestored(id: string, restoredAt: string): Promise<InputRow>;
  /** Development seed only: every comment on the hub. */
  deleteAll(): Promise<void>;
}

export const inputStore = storeSlot<InputStore>("civic.input");
