// Loading the feature packages (ADR-016): the host's list (config/features.ts)
// instantiated once, each with its host, and their contributions handed to
// the registries the packages' go through: routes (mountFeatureRoutes), jobs
// (featureJobRunners), the console's Dashboard (featureConsoleSections) and
// the admin digest (featureDigestLines).
//
// A feature reaches the hub only through its host: its own tables (refused
// otherwise, as a package's grant refuses) and the event log as counts.

import { FEATURE_PACKAGES } from "../../config/features.js";
import { forHub, type TableName } from "../db/forHub.js";
import { currentHub, currentHubId } from "../config/hubContext.js";
import { requirePlugin } from "../middleware/pluginGate.js";
import { MANIFEST_LIST } from "../shared/processManifests.js";
import type { ParticipationDeclaration } from "../shared/participation.js";
import type { PluginId } from "../models/hubSettings.js";
import type { JobRunner } from "../jobs/types.js";
import type { Router } from "express";
import type {
  ActorCountPlan,
  DayCount,
  EventLogReader,
  FeatureConsoleSection,
  FeatureDigestLine,
  FeatureHost,
  FeaturePackage,
  FeatureServer,
  ProcessTypeSummary,
} from "./feature.js";
import type { GrantedDb } from "./package.js";
import { refuseReach } from "./grant.js";

/** PostgREST answers at most this many rows; a range that fills it is split. */
const ROW_LIMIT = 1000;

function nextDay(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * A type's own name where its display label is shared with another type's (a
 * brief and a vote's results both show as "Outcome"): `display.name`.
 */
const ownName = (m: (typeof MANIFEST_LIST)[number]) => (m.descriptor.display as { name?: string }).name;

const TYPES: readonly ProcessTypeSummary[] = MANIFEST_LIST.map((m) => ({
  type: m.descriptor.type,
  label: ownName(m) ?? m.descriptor.display.label,
  plural: ownName(m) ? (ownName(m)!.endsWith("s") ? ownName(m)! : `${ownName(m)}s`) : m.descriptor.display.plural,
  residentCreated: m.descriptor.creation.resident !== null,
  participation: (m.participation as ParticipationDeclaration | undefined) ?? null,
}));

/** The event log as counts, for the hub in scope (event_counts_by_day, event_actor_counts). */
export const eventLogReader: EventLogReader = {
  types: () => TYPES,
  async countByDay(tz, from, to) {
    const read = async (a: string, b: string): Promise<DayCount[]> => {
      const rows = await forHub(currentHubId()).rpc<DayCount[]>("event_counts_by_day", { p_tz: tz, p_from: a, p_to: b });
      if (rows.length < ROW_LIMIT) return rows;
      const span = daysBetween(a, b);
      if (span < 1) throw new Error(`event_counts_by_day: one day (${a}) has ${ROW_LIMIT} or more kinds of event`);
      const mid = nextDay(a, Math.floor(span / 2));
      return [...(await read(a, mid)), ...(await read(nextDay(mid, 1), b))];
    };
    return from > to ? [] : read(from, to);
  },
  async countActors(tz, range, plan: ActorCountPlan) {
    return forHub(currentHubId()).rpc<Array<{ measure: string; value: number }>>("event_actor_counts", {
      p_tz: tz,
      p_from: range.from,
      p_to: range.to,
      p_prev_from: range.prevFrom ?? null,
      p_prev_to: range.prevTo ?? null,
      p_plan: plan,
    });
  },
};

function featureDb(pkg: FeaturePackage): GrantedDb {
  const own = pkg.manifest.tables.map((t) => t.name);
  return {
    from(table) {
      if (!own.includes(table)) refuseReach(pkg.name, "table", table);
      return forHub(currentHubId()).from(table as TableName);
    },
  };
}

/** The hub in scope's launch: its first move out of demo, else its creation (D13). */
async function launchedAt(): Promise<string> {
  const rows = await forHub(currentHubId())
    .from("hub_admin_audit_log")
    .select<{ at: string; before: { mode?: string } | null; after: { mode?: string } | null }>("at, before, after")
    .eq("action", "hub.mode")
    .order("at", { ascending: true })
    .limit(100);
  const left = rows.find((r) => r.before?.mode === "demo" && r.after?.mode && r.after.mode !== "demo");
  return left?.at ?? currentHub()?.created_at ?? new Date().toISOString();
}

interface LoadedFeature {
  pkg: FeaturePackage;
  server: FeatureServer;
}

let loaded: LoadedFeature[] | null = null;

function load(): LoadedFeature[] {
  if (!loaded) {
    loaded = FEATURE_PACKAGES.map((pkg) => {
      const host: FeatureHost = { featureId: pkg.manifest.feature, db: () => featureDb(pkg), eventLog: () => eventLogReader, launchedAt };
      return { pkg, server: pkg.server(host) };
    });
  }
  return loaded;
}

export function loadedFeatures(): readonly LoadedFeature[] {
  return load();
}

/** Mount every feature's routes (on the app) or admin routes (on /admin, after its admin check), behind its switch. */
export function mountFeatureRoutes(on: Pick<Router, "use">, which: "routes" | "adminRoutes"): void {
  for (const f of load()) {
    for (const m of f.server[which] ?? []) on.use(m.path, requirePlugin(f.pkg.manifest.feature as PluginId), m.router);
  }
}

/** Every feature's job runners, by job id. */
export function featureJobRunners(): Readonly<Record<string, JobRunner>> {
  return Object.fromEntries(load().flatMap((f) => Object.entries(f.server.jobs ?? {})));
}

/** Every feature's console sections. */
export function featureConsoleSections(): readonly FeatureConsoleSection[] {
  return load().flatMap((f) => f.server.consoleSections ?? []);
}

/** Every feature's admin digest lines, with the feature they belong to. */
export function featureDigestLines(): ReadonlyArray<{ feature: string; line: FeatureDigestLine }> {
  return load().flatMap((f) => (f.server.digestLines ?? []).map((line) => ({ feature: f.pkg.manifest.feature, line })));
}
