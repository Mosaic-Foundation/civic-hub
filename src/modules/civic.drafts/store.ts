// What civic.drafts keeps, as the host supplies it (ADR-012, the database
// convention): the module never imports src/db/. The implementation is
// src/stores/drafts.ts, bound at startup by installStores().
//
// One store serves every kind of draft: each kind names its own table in its
// DraftSpec, and every method takes that table.

import { storeSlot } from "../../processes/storeSlot.js";
import type { TableName } from "../../db/forHub.js";

/** A row of a kind's drafts table, as the table has it. */
export type DraftRow = Record<string, unknown>;

export interface DraftsStore {
  /** Store a new draft; the row as stored. */
  insertDraft(table: TableName, row: DraftRow): Promise<DraftRow>;
  /** One draft by id, or null when there is none. */
  findDraft(table: TableName, id: string): Promise<DraftRow | null>;
  /** A user's drafts, most recently updated first, optionally of one status. */
  draftsOf(table: TableName, userId: string, status?: string): Promise<DraftRow[]>;
  /** Update a draft's columns; the row as now stored. */
  updateDraft(table: TableName, id: string, updates: DraftRow): Promise<DraftRow>;
  /** Update a draft's columns, nothing returned. */
  writeDraft(table: TableName, id: string, updates: DraftRow): Promise<void>;
  /** Flip drafting → submitted only if the draft is still "drafting". True when this call won. */
  claimDraft(table: TableName, id: string): Promise<boolean>;
}

export const draftsStore = storeSlot<DraftsStore>("civic.drafts");
