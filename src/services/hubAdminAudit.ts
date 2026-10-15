// The hub admin audit log (Phase 7): every hub-admin action that takes a
// fresh emailed code — sample-content removal, a mode change, an admin or
// board roster change — and a few settings that are claims about the hub
// (Terms and Privacy reviewed), with who did it and the values before and after.
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
  // One sample deleted from Settings → Sample content (admin menu slice).
  | "sample_content.delete_one"
  // The starter word cloud was added and chosen (src/services/starterWordcloud.ts).
  | "wordcloud.starter"
  | "hub.mode"
  | "people.admins"
  | "people.board"
  // An admin closed a process before its deadline, with a note (Actions slice).
  | "process.close_early"
  // Regenerate: an admin made a brief again, or published its new version.
  | "brief.regenerate"
  | "brief.revision_published"
  // An admin sent a feedback item to Civic.Social (feedback routing).
  | "feedback.forward"
  // A member's email invites (members and invites slice): the addresses and
  // what became of them, never the message.
  | "member.invite"
  // "Terms and Privacy reviewed" ticked or unticked under Legal (operations
  // shell): { reviewed: boolean } before and after.
  | "legal.reviewed";

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

export interface HubAdminLogRow {
  id: string;
  at: string;
  actor_email: string;
  action: HubAdminAuditAction;
  before: unknown;
  after: unknown;
}

/** How many rows Settings → Admin log shows. */
export const HUB_ADMIN_LOG_SHOWN = 100;

/**
 * The hub's own admins read their log in Settings → Admin log (admin menu
 * slice, 2026-10-13), newest first. The console reads the same rows through
 * the control plane (listHubAdminAudit).
 */
export async function listHubAdminLog(): Promise<HubAdminLogRow[]> {
  return forHub(currentHubId())
    .from("hub_admin_audit_log")
    .select<HubAdminLogRow>("id, at, actor_email, action, before, after")
    .order("at", { ascending: false })
    .limit(HUB_ADMIN_LOG_SHOWN);
}
