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

import type { RequestHandler, Router } from "express";
import type { FeatureManifest } from "../processes/manifest.js";
import type { JobRunner } from "../jobs/types.js";
import type { GrantedDb, PluginMount } from "./package.js";
export type { FeatureManifest };
import type { ParticipationDeclaration } from "../shared/participation.js";
import type { PublicActivityPage } from "../services/publicActivity.js";
export type { PublicActivityItem, PublicActivityPage } from "../services/publicActivity.js";

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

/** A section a feature adds to the console's Dashboard (src/operator/dashboard/registry.ts). */
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

/**
 * A queue a feature adds for admins (kernel step 4; Feedback's): a count on
 * its admin tab of what is new since that admin last opened it, and a line in
 * the admin digest. The kernel keeps each admin's "last opened" under its
 * name (users.queues_seen_at) and counts only while the feature is on.
 */
export interface FeatureQueue {
  /** Its name: lower case, as the admin tab's count and the seen-mark name it. */
  name: string;
  /** What one item is called in the admin digest ("feedback message"). */
  noun: { one: string; many: string };
  /** Its admin page, a local path ("/admin/feedback"). */
  path: string;
  /** How many items arrived after `since` (ISO) and, when given, at or before `until`. */
  count(since: string, until?: string): Promise<number>;
}

/** What a feature's `server(host)` returns. */
export interface FeatureServer {
  /** Its routes on the hub, each behind its switch. */
  routes?: readonly PluginMount[];
  /** Its admin routes, under /admin, behind the admin check and its switch. */
  adminRoutes?: readonly PluginMount[];
  /**
   * Handlers at paths a protocol fixes at the root of the hub's address
   * (/.well-known/webfinger, /nodeinfo/2.1), which a mount under a path of
   * the feature's own cannot serve. Each sees only requests whose path starts
   * with one of its prefixes, and only while the feature is on; otherwise the
   * request goes on as if it were not there. Mounted before the JSON body
   * parser, so a handler that verifies a signature over the body reads it
   * as it came.
   */
  rootHandlers?: readonly { prefixes: readonly string[]; handler: RequestHandler }[];
  /**
   * What /.well-known/civic.json says about the feature, under
   * `features.<id>`, while it is on: public facts a reader of the hub needs
   * (the fediverse feature: its account, so a reader that follows the hub
   * both ways can recognise its posts). Null says nothing.
   */
  discovery?: () => Record<string, unknown> | null;
  /**
   * What the space's config (GET /hub/config) carries for the feature, under
   * `features.<id>`, while it is on: what its UI needs before any page loads
   * (the Members plugin: whether residents get its page yet). Read for the
   * space in scope; null says nothing.
   */
  hubConfig?: () => Promise<Record<string, unknown> | null>;
  /** A runner for each job its manifest declares, by job id. */
  jobs?: Readonly<Record<string, JobRunner>>;
  consoleSections?: readonly FeatureConsoleSection[];
  digestLines?: readonly FeatureDigestLine[];
  /** Its admin queues (FeatureQueue). */
  queues?: readonly FeatureQueue[];
}

/** What the hub hands a feature. */
export interface FeatureHost {
  readonly featureId: string;
  /** The hub in scope's database, limited to the feature's own tables. */
  db(): GrantedDb;
  /** The event log, read as counts. */
  eventLog(): EventLogReader;
  /**
   * When the hub in scope launched (engine 2, D13): the first time it left
   * demo (its admin log's first `hub.mode` change from demo), else when it
   * was created. ISO.
   */
  launchedAt(): Promise<string>;
  /**
   * What anyone may see happen on the hub in scope, recorded after `since`:
   * the public feed's items (title, kind, page; never who acted), without
   * sample content or anything not public (src/services/publicActivity.ts).
   */
  publicActivity(since: string, options?: { limit?: number; kinds?: ReadonlySet<string> }): Promise<PublicActivityPage>;
  /**
   * Take one attempt against each limit, shared by every server instance
   * (src/db/rateLimit.ts); the first limit already reached, or null.
   */
  rateLimit(checks: readonly FeatureRateLimit[]): Promise<FeatureRateLimit | null>;
  /**
   * When the hub in scope's switch for this feature was last saved on, ISO;
   * null when it is off or was never set (on by default). A save of the
   * Plugins section that leaves it on may move it later, never earlier.
   */
  switchedOnAt(): Promise<string | null>;
}

/** One limit a feature counts against: `limit` attempts per `windowMs` for `value`. */
export interface FeatureRateLimit {
  scope: string;
  by: string;
  value: string;
  limit: number;
  windowMs: number;
}

export interface FeaturePackage {
  /** Its npm name, as its package.json says: "@civic-social/feature-analytics". */
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly manifest: FeatureManifest;
  server(host: FeatureHost): FeatureServer;
}
