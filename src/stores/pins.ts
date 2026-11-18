// The hub's pins (pinning phase 2, migration 20261118230000): the
// `process_pins` table, on the hub in scope.

import { forHub, type HubDb } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";

function db(): HubDb {
  return forHub(currentHubId());
}

/** One pin, as the table has it (hub_id aside). */
export interface PinRow {
  process_id: string;
  pinned_by: string | null;
  pinned_at: string;
  pinned_until: string | null;
}

const PIN_COLUMNS = "process_id, pinned_by, pinned_at, pinned_until";

/** Every pin on the hub, whatever its end date (few rows: pins are capped). */
export async function readPins(): Promise<PinRow[]> {
  return db().from("process_pins").select<PinRow>(PIN_COLUMNS).order("pinned_at", { ascending: false });
}

/** One item's pin, or null. */
export async function readPin(processId: string): Promise<PinRow | null> {
  return db().from("process_pins").select<PinRow>(PIN_COLUMNS).eq("process_id", processId).maybeSingle();
}

export async function writePin(pin: PinRow): Promise<void> {
  await db().from("process_pins").upsert(pin, { onConflict: "hub_id,process_id" });
}

export async function deletePin(processId: string): Promise<void> {
  await db().from("process_pins").delete().eq("process_id", processId);
}
