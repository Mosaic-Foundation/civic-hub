// Feature packages: a hub feature built the way a plugin package is (the
// analytics slice, 2026-10-27; ADR-016). A feature is not a process type, so
// it is not in the catalog; but it lives in one folder (features/<dir>/),
// reaches the hub only through the SDK and src/shared/ (eslint
// `civic/package-boundary`), and contributes its routes, admin routes, jobs,
// console section and digest line through the registries below, beside the
// packages'. It is switched by its hub feature switch (plugin.<id>.enabled,
// src/shared/hubFeatures.ts). Making it installable is a loader change:
// ADR-016 lists what the loader and catalog would need.
//
//   features/<dir>/manifest.ts   its FeatureManifest: plain data (tables, jobs)
//   features/<dir>/index.ts      default-exports a FeaturePackage
//   features/<dir>/ui.tsx        its UI module (ui/src/features.ts)
//   config/features.ts           the host's list of feature packages

import type { Router } from "express";
import type { FeatureManifest } from "../processes/manifest.js";
import type { JobRunner } from "../jobs/types.js";
import type { GrantedDb, PluginMount } from "./package.js";
export type { FeatureManifest };
import type { ParticipationDeclaration } from "../shared/participation.js";

/** One process type as a feature reads it: what it is called and what it counts as participation. */
export interface ProcessTypeSummary {
  type: string;
  label: string;
  plural: string;
  /** Whether residents create one (so its creation is a resident's act). */
  residentCreated: boolean;
  participation: ParticipationDeclaration | null;
}

/** One local day's events of one process type and event type. */
export interface DayCount {
  day: string;
  process_type: string;
  event_type: string;
  events: number;
}

/** A pair (process type or "*", event type) a count is over. */
export interface EventPair {
  t: string;
  e: string;
}

/**
 * What the counts of distinct residents are over (event_actor_counts in
 * 20261027100000_analytics.sql says what each part counts).
 */
export interface ActorCountPlan {
  acts: readonly EventPair[];
  measures: Readonly<Record<string, readonly EventPair[]>>;
  sources: readonly { id: string; t: string; e: string; f: string }[];
  totals: readonly { t: string; e: string; f: string; n: string; of: readonly string[] }[];
}

/**
 * The event log, as a feature may read it (SDK v0's read capability; ADR-016):
 * counts only. No method returns an event, an actor or a payload.
 */
export interface EventLogReader {
  /** The hub's process types, from their manifests. */
  types(): readonly ProcessTypeSummary[];
  /** The hub in scope's events on the local days from..to (YYYY-MM-DD, inclusive) in `tz`. */
  countByDay(tz: string, from: string, to: string): Promise<DayCount[]>;
  /**
   * Counts of distinct residents of the hub in scope over the local days
   * from..to (and prevFrom..prevTo for "returning"), as (measure, value).
   */
  countActors(
    tz: string,
    range: { from: string; to: string; prevFrom?: string | null; prevTo?: string | null },
    plan: ActorCountPlan,
  ): Promise<Array<{ measure: string; value: number }>>;
}

/** A section a feature adds to the console's Dashboard (src/control/dashboard/registry.ts). */
export interface FeatureConsoleSection {
  id: string;
  name: string;
  /**
   * Called with every live hub and a way to run something inside one hub's
   * scope; returns plain data for its renderer (the feature's console.tsx).
   */
  load(ctx: {
    now: Date;
    hubs: readonly { id: string; name: string; origin: string }[];
    inHub<T>(hubId: string, fn: () => Promise<T>): Promise<T>;
  }): Promise<unknown>;
}

/** A line a feature adds to the hub's admin digest, or null for none this time. */
export type FeatureDigestLine = (ctx: { now: Date }) => Promise<string | null>;

/** What a feature's `server(host)` returns. */
export interface FeatureServer {
  /** Its routes on the hub, each behind its switch. */
  routes?: readonly PluginMount[];
  /** Its admin routes, under /admin, behind the admin check and its switch. */
  adminRoutes?: readonly PluginMount[];
  /** A runner for each job its manifest declares, by job id. */
  jobs?: Readonly<Record<string, JobRunner>>;
  consoleSections?: readonly FeatureConsoleSection[];
  digestLines?: readonly FeatureDigestLine[];
}

/** What the hub hands a feature. */
export interface FeatureHost {
  readonly featureId: string;
  /** The hub in scope's database, limited to the feature's own tables. */
  db(): GrantedDb;
  /** The event log, read as counts. */
  eventLog(): EventLogReader;
}

export interface FeaturePackage {
  /** Its npm name, as its package.json says: "@civic-social/feature-analytics". */
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly manifest: FeatureManifest;
  server(host: FeatureHost): FeatureServer;
}
