// What a plugin package is (plugin session 1, ADR-014; the outside
// developer's contract is docs/PLUGIN-PACKAGE.md).
//
// A package is a directory under packages/ (an npm package later) holding:
//
//   package.json    its name and version, as its index.ts states them;
//   manifest.ts     its ProcessManifest: plain data the UI also reads, with
//                   its capability grant (`capabilities`, §4.1) and what each
//                   of its tables holds in plain words (`tables[].holds`);
//   index.ts        default-exports a PluginPackage (below): name, version,
//                   display name, manifest, and `server(host)`, which returns
//                   its handler, its routes and its jobs;
//   ui.tsx          its UI module (ADR-009's registry entry: routes, feed
//                   cards, settings panel);
//   migrations/     its own SQL migrations, copied into supabase/migrations/
//                   by `npm run plugins:sync` and applied with the hub's own.
//
// Its conformance inputs are its descriptor's `examples` (the suite drives
// the type with them; tests/conformance/README.md).
//
// The hub loads the packages named in config/plugins.json (the hosting
// layer's list; the engine never names a package). The loader
// (src/plugins/loader.ts) checks each one, hashes its files, and mounts it
// only when an approved catalog row records that exact hash.

import type { Router } from "express";
import type { ProcessManifest } from "../processes/manifest.js";
import type { ProcessHandler } from "../processes/types.js";
import type { JobRunner } from "../jobs/types.js";
import type { Adapters } from "../adapters/index.js";
import type { aiComplete, aiConfigured, aiDefaultModel } from "../adapters/ai.js";
import type { sendEmail as sendMessage } from "../utils/email.js";
import type { sendEmail as deliverEmail } from "../services/mailer.js";
import type { GrantableAdapter } from "../shared/pluginGrant.js";
import type { HubQueryBuilder } from "../db/forHub.js";

/** A router a package mounts, at `path` on the hub (or under /admin, behind the admin check). */
export interface PluginMount {
  path: string;
  router: Router;
}

/** What a package's `server(host)` returns. */
export interface PluginServer {
  /** The handler that runs its type's actions (its descriptor is its manifest's). */
  handler: ProcessHandler;
  /** Its routes, in mount order. Each is mounted behind its plugin's switch. */
  routes?: readonly PluginMount[];
  /** Its admin routes, under /admin, behind the admin check and its plugin's switch. */
  adminRoutes?: readonly PluginMount[];
  /** A runner for each job its manifest declares, by job id. */
  jobs?: Readonly<Record<string, JobRunner>>;
}

/** The database a package's store reaches: the hub in scope, its granted tables only. */
export interface GrantedDb {
  from(table: string): HubQueryBuilder;
}

/**
 * What each grantable adapter is, as a package reaches it. AI goes through
 * the hub's gate (usage recorded by purpose, the jobs' daily ceiling); mail
 * through the hub's guard (beta hubs, the platform's sending domain).
 */
export interface PluginAdapters {
  ai: { complete: typeof aiComplete; configured: typeof aiConfigured; defaultModel: typeof aiDefaultModel };
  mail: {
    /** One message, through the hub's mail guard (src/utils/email.ts). */
    send: typeof sendMessage;
    /** One message with a delivery report per recipient (src/services/mailer.ts). */
    deliver: typeof deliverEmail;
  };
  video: Adapters["video"];
  deliberation: Adapters["deliberation"];
  objectStore: Adapters["objectStore"];
}

/**
 * What the hub hands a package (§5a Stage 1: state through a host-provided
 * store, outside services through the adapters it was granted). A reach past
 * the grant throws GrantRefusedError and is reported.
 */
export interface PluginHost {
  /** The package's name, as its catalog row names it. */
  readonly packageName: string;
  /** The hub in scope's database, limited to the package's granted tables. */
  db(): GrantedDb;
  /** One of its granted adapters. */
  adapter<K extends GrantableAdapter>(name: K): PluginAdapters[K];
}

export interface PluginPackage {
  /** Its npm name: "@civic-social/plugin-vote". */
  readonly name: string;
  /** Its version (semver), equal to its package.json's. */
  readonly version: string;
  /** What the catalog and the Plugins page call it: "Votes". */
  readonly displayName: string;
  readonly manifest: ProcessManifest;
  /** Packages it needs loaded alongside it, by name (a vote makes a brief when it closes). */
  readonly requires?: readonly string[];
  /** Called once, when the hub loads it. */
  server(host: PluginHost): PluginServer;
}

/** One entry of the configured list, as plugins:sync writes it (config/plugins/server.ts). */
export interface ConfiguredPackage {
  /** Its directory, relative to the civic-hub root: "packages/civic.vote". */
  dir: string;
  pkg: PluginPackage;
}
