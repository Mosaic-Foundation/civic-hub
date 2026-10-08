// Removing a hub's sample content (Phase 7), and what the warning says first.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Phase 7 — Sample content for new
// hubs". The control is in the hub admin's settings in every mode, and
// graduating out of demo asks the same question. It takes a fresh emailed
// code (the controller checks it) and is recorded in hub_admin_audit_log.
//
// WHAT GOES: every sample process, every row that belongs to one (the one
// list in src/models/sampleContent.ts, which the export shares), every
// sample event, and the synthetic authors. That includes real people's input
// on sample processes — a comment, an endorsement, a ballot — because it has
// nothing left to belong to; the warning counts it first.
//
// Through forHub(), as the hub app writes everything else. Under hub tokens
// the database allows the event deletes because they are sample events
// (events_delete_guard); a real event is refused, which is the point.
//
// Not one transaction: PostgREST has none across statements. The order is
// children first, then processes, then users, and every step deletes "what
// is still there", so a removal that stops part-way is finished by running
// it again. No step touches a non-sample row.

import { SAMPLE_HOLD_REASON, type DeliveryReport } from "../shared/delivery.js";
import { forHub, type HubDb, type TableName } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import {
  PARTICIPATION_TABLES,
  PROCESS_CHILD_COLUMNS,
} from "../models/sampleContent.js";
import { recordHubAdminAudit } from "./hubAdminAudit.js";
import { getSetting, setSetting } from "./hubSettings.js";
import { KEYS } from "../models/hubSettings.js";

function db(): HubDb {
  return forHub(currentHubId());
}

export interface SampleContentSummary {
  /** Sample processes, by type. */
  processes: number;
  by_type: Record<string, number>;
  /** Synthetic authors. */
  users: number;
  /**
   * Real people's input on sample processes, deleted with them — by kind
   * (comment, endorsement, ballot, statement, submission).
   */
  real_input: Record<string, number>;
  real_input_total: number;
  /** Processes that are NOT sample: what the hub has left afterwards. */
  other_processes: number;
}

async function sampleProcesses(): Promise<Array<{ id: string; type: string }>> {
  return db().from("processes").select<{ id: string; type: string }>("id, type").eq("is_sample", true);
}

async function sampleUserIds(): Promise<string[]> {
  const rows = await db().from("users").select<{ id: string }>("id").eq("is_sample", true);
  return rows.map((r) => r.id);
}

/** What removal would take, for the warning. Nothing is written. */
export async function sampleContentSummary(): Promise<SampleContentSummary> {
  const procs = await sampleProcesses();
  const ids = procs.map((p) => p.id);
  const users = await sampleUserIds();
  const by_type: Record<string, number> = {};
  for (const p of procs) by_type[p.type] = (by_type[p.type] ?? 0) + 1;

  const real_input: Record<string, number> = {};
  let real_input_total = 0;
  if (ids.length > 0) {
    for (const t of PARTICIPATION_TABLES) {
      let q = db().from(t.table as TableName).count().in(t.processColumn, ids);
      if (users.length > 0) q = q.not(t.userColumn, "in", `(${users.join(",")})`);
      const n = await q;
      if (n > 0) {
        real_input[t.kind] = (real_input[t.kind] ?? 0) + n;
        real_input_total += n;
      }
    }
  }

  const other_processes = await db().from("processes").count().eq("is_sample", false);
  return { processes: procs.length, by_type, users: users.length, real_input, real_input_total, other_processes };
}

export interface SampleRemovalResult {
  summary: SampleContentSummary;
  deleted: Record<string, number>;
}

/**
 * Delete all of this hub's sample content and record who did it. The caller
 * has already checked the admin and the fresh code.
 */
export async function removeSampleContent(actorEmail: string): Promise<SampleRemovalResult> {
  const summary = await sampleContentSummary();
  const ids = (await sampleProcesses()).map((p) => p.id);
  const users = await sampleUserIds();
  const deleted: Record<string, number> = {};

  const del = async (table: TableName, column: string, values: string[]): Promise<void> => {
    if (values.length === 0) return;
    const n = await db().from(table).count().in(column, values);
    if (n === 0) return;
    await db().from(table).delete().in(column, values);
    deleted[table] = (deleted[table] ?? 0) + n;
  };

  // 1. Rows that belong to a sample process — every table in the shared
  //    list except the marked ones and the process-sharing rows, which go
  //    below. (FK cascades would take some of these anyway; deleting them
  //    explicitly counts them and covers the tables with no FK.)
  const later = new Set(["events", "proposals", "projects"]);
  for (const [table, cols] of Object.entries(PROCESS_CHILD_COLUMNS)) {
    if (later.has(table)) continue;
    for (const c of cols) await del(table as TableName, c, ids);
  }
  // 2. The module rows that share their process's id.
  await del("proposals", "id", ids);
  await del("projects", "id", ids);
  // 3. Sample events: stamped by the database, so this is every event of
  //    every sample process, whoever wrote it.
  {
    const n = await db().from("events").count().eq("is_sample", true);
    if (n > 0) {
      await db().from("events").delete().eq("is_sample", true);
      deleted.events = n;
    }
  }
  // 4. The processes.
  await del("processes", "id", ids);
  // 5. The synthetic authors (their sessions cascade).
  await del("users", "id", users);
  // 6. A setting that names a sample process would point at nothing: the
  //    hub's word cloud, which the seed chooses when there is none.
  const cleared: string[] = [];
  const chosen = await getSetting(currentHubId(), KEYS.PLUGIN_WORDCLOUD_ONBOARDING_ID);
  if (chosen && ids.includes(chosen)) {
    await setSetting(currentHubId(), KEYS.PLUGIN_WORDCLOUD_ONBOARDING_ID, "", actorEmail);
    cleared.push(KEYS.PLUGIN_WORDCLOUD_ONBOARDING_ID);
  }

  await recordHubAdminAudit({
    actor: actorEmail,
    action: "sample_content.remove",
    before: summary,
    after: cleared.length ? { deleted, cleared } : { deleted },
  });
  console.log(
    `[hub] sample content removed on ${currentHubId()} by ${actorEmail}: ` +
      `${summary.processes} processes, ${summary.real_input_total} real inputs, ${summary.users} sample users`,
  );
  return { summary, deleted };
}

/**
 * The mailer for a sample process's brief or results (Phase 7): nothing goes
 * out. A sample vote closes on schedule and spawns a sample brief like any
 * other; an admin may approve it to see the flow, and on a live hub the
 * recipients are real officials. Illustrative content is never delivered.
 */
export async function sampleDeliverySuppressed(message: { to: string[]; subject: string }): Promise<DeliveryReport> {
  console.log(
    `[email] SUPPRESSED (sample content) hub=${currentHubId()} to=${message.to.length} recipient(s) subject="${message.subject}"`,
  );
  return { sent: [], held_back: message.to.map((email) => ({ email, reason: SAMPLE_HOLD_REASON })) };
}

/**
 * What the hub's public pages need to know about its content (2026-10-07,
 * review R27, R45): whether any sample content is left — the beta bar stops
 * calling the hub's content "demo content" once it is gone — and whether the
 * hub has written a Welcome page, without which no link points at /welcome.
 * Two counts on every boot; a failed read answers "none", which only drops a
 * sentence or a link.
 */
export async function hubContentFlags(hubId: string): Promise<{ samples: boolean; welcome: boolean }> {
  const db = forHub(hubId);
  const [samples, welcome] = await Promise.all([
    db.from("processes").count().eq("is_sample", true).then((n) => n > 0, () => false),
    db.from("hub_settings").count().eq("key", KEYS.COPY_WELCOME).neq("value", "").then((n) => n > 0, () => false),
  ]);
  return { samples, welcome };
}
