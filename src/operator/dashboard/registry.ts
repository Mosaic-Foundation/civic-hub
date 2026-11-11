// The hub's sections of the console Dashboard (the dashboard slice,
// 2026-10-17; split from src/control/dashboard/registry.ts at the console
// split): everything that reads hub data. The console asks for them through
// the operator API (../api.ts → dashboard) and adds its own sections, the
// ones that read outside services.
//
// A section is a name, a loader here and a renderer listed under the same id
// in ui/src/console/dashboardSections.tsx (HANDOFF.md, "Dashboard: adding a
// section"). Aggregate data only: nothing per person reaches the page.

import { loadHubs } from "./hubs.js";
import { loadJobs } from "./jobs.js";
import { loadAttention } from "./attention.js";
import { loadPluginGaps } from "../pluginCatalog.js";
import { featureConsoleSections } from "../../plugins/features.js";
import type { FeatureConsoleSection } from "../../plugins/feature.js";
import { env } from "../../config/env.js";
import { hubOrigin } from "../../utils/baseUrl.js";
import { listHubs } from "../hubs.js";
import { inHubScope } from "../inHub.js";
import { HUBS_TIMEOUT_MS, runSections, type DashboardSection, type SectionContext, type SectionResult } from "../../shared/dashboardRun.js";

/** The hub's sections, in page order. The console puts its own after "jobs". */
export const HUB_DASHBOARD_SECTIONS: readonly DashboardSection[] = [
  // Each hub's check may take two 8 s attempts, five hubs at a time
  // (hubHealth.ts): 15 hubs that all fail take 48 s. The rest stay at 8 s.
  { id: "hubs", name: "Hubs", load: loadHubs, timeoutMs: HUBS_TIMEOUT_MS },
  { id: "jobs", name: "Jobs and backups", load: loadJobs },
  { id: "attention", name: "Waiting for attention", load: loadAttention },
  // Plugin packages this deployment loads but does not mount (ADR-014), and
  // the hubs left without them; catalog entries waiting for approval.
  { id: "plugins", name: "Plugins", load: loadPluginGaps },
  // Feature packages' sections (ADR-016): Activity. Each gets the live hubs
  // and runs its reads inside each hub's scope.
  ...featureConsoleSections().map(asDashboardSection),
];

/** A feature's section, given what it needs: the live hubs and each one's scope. */
function asDashboardSection(s: FeatureConsoleSection): DashboardSection {
  return {
    id: s.id,
    name: s.name,
    timeoutMs: HUBS_TIMEOUT_MS,
    load: async (ctx) => {
      const base = env.CIVIC_UI_BASE_URL ?? env.BASE_URL ?? "http://localhost:3000";
      const hubs = (await listHubs())
        .filter((h) => !h.archived_at)
        .map((h) => ({ id: h.id, name: h.name, origin: hubOrigin(h.hostname, base) }));
      return s.load({ now: ctx.now, hubs, inHub: inHubScope });
    },
  };
}

export async function hubDashboardSections(
  ctx: SectionContext,
  sections: readonly DashboardSection[] = HUB_DASHBOARD_SECTIONS,
): Promise<SectionResult[]> {
  return runSections(sections, ctx);
}
