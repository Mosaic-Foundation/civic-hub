// @civic-raw-client-importer: the super admin's audit log is platform data, written across hubs as the service role.
// Every super admin action, written before the response goes out: who, what,
// which hub, and the values before and after. `control_audit_log` is
// append-only (a trigger refuses UPDATE and DELETE for every role) and is
// not hub data (tests/fixtures/tenancyCatalog.ts → NOT_HUB_SCOPED).
//
// A write that fails throws: an action the log did not record is reported to
// the operator as failed, never as done.

import { getDb } from "../db/client.js";

export interface AuditEntry {
  actor: string;
  action: string;
  hubId?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface AuditRow {
  id: number;
  at: string;
  actor_email: string;
  action: string;
  target_hub_id: string | null;
  before: unknown;
  after: unknown;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  const { error } = await getDb().from("control_audit_log").insert({
    actor_email: entry.actor,
    action: entry.action,
    target_hub_id: entry.hubId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
  if (error) throw new Error(`audit log write failed: ${error.message}`);
}

export async function listAudit(opts: { hubId?: string; limit?: number } = {}): Promise<AuditRow[]> {
  let q = getDb()
    .from("control_audit_log")
    .select("id, at, actor_email, action, target_hub_id, before, after")
    .order("at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  if (opts.hubId) q = q.eq("target_hub_id", opts.hubId);
  const { data, error } = await q;
  if (error) throw new Error(`audit log read failed: ${error.message}`);
  return (data ?? []) as AuditRow[];
}
