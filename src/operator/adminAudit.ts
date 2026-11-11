// @civic-raw-client-importer: the operator reads one hub's own admin log (hub data) for the console, as the service role.
// The hub admins' own log, read for the console through the operator API
// (./api.ts). Moved from src/control/audit.ts at the console split: the
// console no longer reads hub tables.

import { getDb } from "../db/client.js";

export interface HubAdminAuditRow {
  id: string;
  at: string;
  actor_email: string;
  action: string;
  before: unknown;
  after: unknown;
}

/**
 * One hub's hub_admin_audit_log: what its own admins did with a fresh code
 * (sample-content removal, mode changes, roster changes). Hub data, written
 * by the hub app; the operator API serves it to the console, so the
 * operator sees it without anything being copied into control_audit_log.
 */
export async function listHubAdminAudit(hubId: string, limit = 100): Promise<HubAdminAuditRow[]> {
  const { data, error } = await getDb()
    .from("hub_admin_audit_log")
    .select("id, at, actor_email, action, before, after")
    .eq("hub_id", hubId)
    .order("at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(`hub admin audit read failed: ${error.message}`);
  return (data ?? []) as HubAdminAuditRow[];
}
