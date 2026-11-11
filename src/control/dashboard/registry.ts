// The console's Dashboard: one page of sections (the dashboard slice, 2026-10-17).
//
// Since the console split, most sections are the hub's: the console asks the
// hub for them through the operator API (src/operator/dashboard/registry.ts)
// and adds the ones that read outside services itself: "Uptime and errors",
// and the backup in "Jobs and backups". Each runs under its own timeout
// (src/shared/dashboardRun.ts), so one slow source never blanks the page.
//
// Platform admin only: GET /control/dashboard sits behind the console's
// session check (src/control/router.ts). Aggregate data only.

import { backupStatus, loadOutside } from "./outside.js";
import type { OperatorApi } from "../../operator/api.js";
import { runSection, type DashboardPayload, type DashboardSection, type SectionResult } from "../../shared/dashboardRun.js";

export type { DashboardPayload, SectionResult };

/** The console's own sections. */
export const CONSOLE_DASHBOARD_SECTIONS: readonly DashboardSection[] = [
  { id: "outside", name: "Uptime and errors", load: (ctx) => loadOutside(ctx) },
];

export async function gatherDashboard(
  op: OperatorApi,
  opts: { fresh?: boolean; now?: Date; sections?: readonly DashboardSection[] } = {},
): Promise<DashboardPayload> {
  const now = opts.now ?? new Date();
  const fresh = opts.fresh ?? false;
  const ctx = { now, fresh };
  const [hub, own, backup] = await Promise.all([
    op.dashboard({ fresh, now: now.toISOString() }),
    Promise.all((opts.sections ?? CONSOLE_DASHBOARD_SECTIONS).map((s) => runSection(s, ctx))),
    backupStatus(fresh),
  ]);
  // The backup belongs in the hub's "Jobs and backups" section.
  const sections = hub.map((s) =>
    s.id === "jobs" && s.status === "ok" ? { ...s, data: { ...(s.data as object), backup } } : s,
  );
  // Page order as before the split: hubs, jobs, then the console's own, then the rest.
  const at = sections.findIndex((s) => s.id === "jobs");
  sections.splice(at >= 0 ? at + 1 : sections.length, 0, ...own);
  return { gathered_at: now.toISOString(), sections };
}
