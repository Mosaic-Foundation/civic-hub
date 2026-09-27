// The hub admin audit log (Phase 7): every hub-admin action that takes a
// fresh emailed code — sample-content removal, a mode change, an admin or
// board roster change — with who did it and the values before and after.
//
// Hub data, unlike the console's control_audit_log: the table carries hub_id
// under forced RLS, is written through forHub() like everything else the hub
// app writes, and leaves with the hub's export. Append-only for every role
// (trigger). The console reads it through the control plane
// (src/control/hubs.ts → listHubAdminAudit); nothing is mirrored.
//
// A write that fails throws, so the caller reports the action as not
// recorded rather than quietly done.

import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";

export type HubAdminAuditAction =
  | "sample_content.remove"
  | "hub.mode"
  | "people.admins"
  | "people.board";

export interface HubAdminAuditEntry {
  actor: string;
  action: HubAdminAuditAction;
  before?: unknown;
  after?: unknown;
}

export async function recordHubAdminAudit(entry: HubAdminAuditEntry): Promise<void> {
  await forHub(currentHubId())
    .from("hub_admin_audit_log")
    .insert({
      actor_email: entry.actor,
      action: entry.action,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
}
