// Every super admin action, written before the response goes out: who, what,
// which hub, and the values before and after. `console.control_audit_log`
// is append-only (a trigger refuses UPDATE and DELETE for every role, and
// civic_console has no right to either) and is not hub data. Written as
// civic_console (./db.ts; the console split, step 3b).
//
// A write that fails throws: an action the log did not record is reported to
// the operator as failed, never as done.

import { q } from "./db.js";

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
  await q(
    "INSERT INTO console.control_audit_log (actor_email, action, target_hub_id, before, after) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)",
    [entry.actor, entry.action, entry.hubId ?? null, json(entry.before), json(entry.after)],
  );
}

/** A value as jsonb text; null stays SQL null. */
function json(v: unknown): string | null {
  return v === undefined || v === null ? null : JSON.stringify(v);
}

export async function listAudit(opts: { hubId?: string; limit?: number } = {}): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const { rows } = await q<Omit<AuditRow, "at"> & { at: unknown }>(
    `SELECT id::float8 AS id, at, actor_email, action, target_hub_id, before, after
       FROM console.control_audit_log
      WHERE ($1::text IS NULL OR target_hub_id = $1)
      ORDER BY at DESC
      LIMIT $2`,
    [opts.hubId ?? null, limit],
  );
  return rows.map((r) => ({ ...r, at: r.at instanceof Date ? r.at.toISOString() : String(r.at) }));
}
