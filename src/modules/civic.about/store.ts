// What civic.about keeps, as the host supplies it (ADR-012, the database
// convention): the module never imports src/db/. The implementation is
// src/stores/about.ts, bound at startup by installStores().

import { storeSlot } from "../../processes/storeSlot.js";

/** A `member_about` row, as the table has it (hub_id aside). */
export interface MemberAboutRow {
  user_id: string;
  district_id: string | null;
  birth_year: number | null;
  race: string[];
  declined: string[];
  asked_at: string | null;
  updated_at?: string;
}

export interface AboutStore {
  /** One member's row on the hub in scope, or null when they have none. */
  get(userId: string): Promise<MemberAboutRow | null>;
  /** Write one member's row whole (insert or replace), on the hub in scope. */
  put(row: MemberAboutRow): Promise<void>;
  /** The rows of these members, on the hub in scope (for totals only; never served one by one). */
  forUsers(userIds: readonly string[]): Promise<MemberAboutRow[]>;
}

export const aboutStore = storeSlot<AboutStore>("civic.about");
