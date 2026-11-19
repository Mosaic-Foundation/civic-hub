// The Pinning plugin's table, `process_pins` (migrations 20261118230000 and
// 20261119200000), on the space in scope, through the plugin's own grant.

import type { FeatureHost } from "../../src/sdk/index.js";

/** One pin, as the table has it (hub_id aside). */
export interface PinRow {
  process_id: string;
  pinned_by: string | null;
  pinned_at: string;
  pinned_until: string | null;
  urgent: boolean;
}

const PIN_COLUMNS = "process_id, pinned_by, pinned_at, pinned_until, urgent";

export interface PinStore {
  /** Every pin, whatever its end date (few rows: pins are capped). */
  all(): Promise<PinRow[]>;
  one(processId: string): Promise<PinRow | null>;
  write(pin: PinRow): Promise<void>;
  remove(processId: string): Promise<void>;
}

export function pinStore(host: Pick<FeatureHost, "db">): PinStore {
  const table = () => host.db().from("process_pins");
  return {
    async all() {
      return table().select<PinRow>(PIN_COLUMNS).order("pinned_at", { ascending: false });
    },
    async one(processId) {
      return table().select<PinRow>(PIN_COLUMNS).eq("process_id", processId).maybeSingle();
    },
    async write(pin) {
      await table().upsert(pin, { onConflict: "hub_id,process_id" });
    },
    async remove(processId) {
      await table().delete().eq("process_id", processId);
    },
  };
}
