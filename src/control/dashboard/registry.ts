// The console's Dashboard: one page of sections (the dashboard slice, 2026-10-17).
//
// A section is a name, a server-side loader and a renderer. The loader is
// listed here; its renderer is listed under the same id in
// ui/src/console/dashboardSections.tsx. Adding a section is one entry in
// each list (HANDOFF.md, "Dashboard: adding a section").
//
// Every loader runs at once, each under its own timeout, so one slow source
// never blanks the page: a section that times out or throws comes back with
// `status` saying so, and the others still render. A loader that reads an
// outside service handles its own "not connected" and errors (outside.ts),
// so it only fails here when something of ours does.
//
// Platform admin only: GET /control/dashboard sits behind the console's
// session check (src/control/router.ts). Aggregate data only: nothing per
// person reaches the page.

import { loadHubs } from "./hubs.js";
import { loadJobs } from "./jobs.js";
import { loadOutside } from "./outside.js";
import { loadAttention } from "./attention.js";
import { loadPluginGaps } from "../pluginCatalog.js";

export interface SectionContext {
  now: Date;
  /** The manual refresh: skip the one-minute caches. */
  fresh: boolean;
}

export interface DashboardSection {
  /** Stable id; the UI's renderer is keyed by it. */
  readonly id: string;
  /** The heading on the page. */
  readonly name: string;
  readonly load: (ctx: SectionContext) => Promise<unknown>;
  /** Defaults to SECTION_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

/** Long enough for any section's database reads and an outside service's 5 s. */
export const SECTION_TIMEOUT_MS = 8_000;
/** The hubs section: every hub's health, retries included, five at a time. */
export const HUBS_TIMEOUT_MS = 60_000;

export const DASHBOARD_SECTIONS: readonly DashboardSection[] = [
  // Each hub's check may take two 8 s attempts, five hubs at a time
  // (hubHealth.ts): 15 hubs that all fail take 48 s. The rest stay at 8 s.
  { id: "hubs", name: "Hubs", load: loadHubs, timeoutMs: HUBS_TIMEOUT_MS },
  { id: "jobs", name: "Jobs and backups", load: loadJobs },
  { id: "outside", name: "Uptime and errors", load: loadOutside },
  { id: "attention", name: "Waiting for attention", load: loadAttention },
  // Plugin packages this deployment loads but does not mount (ADR-014), and
  // the hubs left without them; catalog entries waiting for approval.
  { id: "plugins", name: "Plugins", load: loadPluginGaps },
];

export interface SectionResult {
  id: string;
  name: string;
  status: "ok" | "timeout" | "error";
  /** How long the loader took (or the timeout). */
  ms: number;
  data: unknown;
  /** One line when status is not ok. */
  message?: string;
}

export interface DashboardPayload {
  gathered_at: string;
  sections: SectionResult[];
}

class SectionTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SectionTimeout(`took longer than ${ms / 1000} s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function runSection(section: DashboardSection, ctx: SectionContext): Promise<SectionResult> {
  const started = Date.now();
  const timeoutMs = section.timeoutMs ?? SECTION_TIMEOUT_MS;
  try {
    const data = await withTimeout(Promise.resolve().then(() => section.load(ctx)), timeoutMs);
    return { id: section.id, name: section.name, status: "ok", ms: Date.now() - started, data };
  } catch (err) {
    const timedOut = err instanceof SectionTimeout;
    if (!timedOut) console.warn(`[dashboard] section ${section.id} failed:`, err);
    return {
      id: section.id,
      name: section.name,
      status: timedOut ? "timeout" : "error",
      ms: Date.now() - started,
      data: null,
      message: timedOut ? `This section ${(err as Error).message}.` : "This section could not be loaded.",
    };
  }
}

export async function gatherDashboard(
  opts: { fresh?: boolean; now?: Date; sections?: readonly DashboardSection[] } = {},
): Promise<DashboardPayload> {
  const now = opts.now ?? new Date();
  const ctx: SectionContext = { now, fresh: opts.fresh ?? false };
  const sections = await Promise.all((opts.sections ?? DASHBOARD_SECTIONS).map((s) => runSection(s, ctx)));
  return { gathered_at: now.toISOString(), sections };
}
