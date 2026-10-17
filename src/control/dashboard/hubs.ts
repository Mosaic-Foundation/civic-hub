// Dashboard section "Hubs": one row per hub, every mode.
//
// Name, mode, the commit its /api/health reports and whether it is the
// console's own (one deployment serves every hub, so a different commit means
// that hostname reaches another deployment), health with any schema gaps, the
// member count, and days since the last activity.
//
// Order: live, beta (real people are on both: production), demo, then
// archived, which the page shows collapsed. An archived hub's health is not
// read: it is meant to be off.

import { deploymentCommit } from "../../config/deployment.js";
import { forHub } from "../../db/forHub.js";
import { currentHubId } from "../../config/hubContext.js";
import { memberVisibility } from "../../services/members.js";
import { listHubs, type ControlHub } from "../hubs.js";
import { inHubScope } from "../inHub.js";
import { hubHealth, type HubHealth } from "./hubHealth.js";
import type { SectionContext } from "./registry.js";

export type HubGroup = "live" | "beta" | "demo" | "archived";

export const HUB_GROUP_ORDER: readonly HubGroup[] = ["live", "beta", "demo", "archived"];

export interface HubRow {
  id: string;
  name: string;
  hostname: string;
  mode: string | null;
  group: HubGroup;
  /** "suspended" shows beside the name. */
  status: string;
  health: HubHealth | null;
  /** Null when the hub didn't answer, or reported no commit. */
  commit: string | null;
  commit_matches: boolean | null;
  members: number | null;
  last_activity_at: string | null;
  days_since_activity: number | null;
}

export interface HubsSection {
  console_commit: string;
  hubs: HubRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function hubGroup(hub: Pick<ControlHub, "archived_at" | "mode">): HubGroup {
  if (hub.archived_at) return "archived";
  return hub.mode === "live" || hub.mode === "beta" ? hub.mode : "demo";
}

/** Members and the newest real event, read inside the hub's own scope. */
async function hubCounts(hubId: string): Promise<{ members: number; last: string | null }> {
  return inHubScope(hubId, async () => {
    const db = forHub(currentHubId());
    const [visibility, newest] = await Promise.all([
      memberVisibility(),
      db
        .from("events")
        .select<{ recorded_at: string }>("recorded_at")
        .eq("is_sample", false)
        .order("recorded_at", { ascending: false })
        .limit(1),
    ]);
    return { members: visibility.count, last: newest[0]?.recorded_at ?? null };
  });
}

async function hubRow(hub: ControlHub, ctx: SectionContext, consoleCommit: string): Promise<HubRow> {
  const group = hubGroup(hub);
  const [health, counts] = await Promise.all([
    group === "archived" ? Promise.resolve(null) : hubHealth(hub, ctx.fresh),
    hubCounts(hub.id).catch((err) => {
      console.warn(`[dashboard] counts for ${hub.id} failed:`, err);
      return null;
    }),
  ]);
  const commit = health?.commit && health.commit !== "unknown" ? health.commit : null;
  const last = counts?.last ?? null;
  return {
    id: hub.id,
    name: hub.name,
    hostname: hub.hostname,
    mode: hub.mode,
    group,
    status: hub.status,
    health,
    commit,
    commit_matches: commit ? commit === consoleCommit : null,
    members: counts?.members ?? null,
    last_activity_at: last,
    days_since_activity: last ? Math.floor((ctx.now.getTime() - new Date(last).getTime()) / DAY_MS) : null,
  };
}

export async function loadHubs(ctx: SectionContext): Promise<HubsSection> {
  const consoleCommit = deploymentCommit();
  const hubs = await listHubs();
  const rows = await Promise.all(hubs.map((h) => hubRow(h, ctx, consoleCommit)));
  rows.sort(
    (a, b) => HUB_GROUP_ORDER.indexOf(a.group) - HUB_GROUP_ORDER.indexOf(b.group) || a.name.localeCompare(b.name),
  );
  return { console_commit: consoleCommit, hubs: rows };
}
