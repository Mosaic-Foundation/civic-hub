// Every process type this hub software carries, as its manifest
// (src/processes/manifest.ts; ADR-009). The one list of types: the server's
// registry pairs each with its handler and checks it at startup, and the UI
// reads the same list for labels, colours and the feed. Order is the
// registry's (it decides nothing a resident sees; sections carry their own).
//
// The types are plugin packages (ADR-014): the configured list
// (config/plugins.json, written out by `npm run plugins:sync` as
// config/plugins/manifests.ts) supplies their manifests. Adding a type is
// adding a package and a line in config/plugins.json.

import { PACKAGE_MANIFESTS } from "../../config/plugins/manifests.js";
import type { ProcessManifest } from "../processes/manifest.js";

export const PROCESS_MANIFESTS = PACKAGE_MANIFESTS;
/** The same list, each as a plain ProcessManifest (for reading fields every manifest has). */
export const MANIFEST_LIST: readonly ProcessManifest[] = PROCESS_MANIFESTS;

/** Every process plugin id: the plugin each manifest's type belongs to. */
export type ProcessPluginId = (typeof PROCESS_MANIFESTS)[number]["descriptor"]["plugin"];

/** Every table a process type owns, by name. */
export type ProcessTableName = (typeof PROCESS_MANIFESTS)[number]["tables"][number]["name"];

/**
 * The retired types the configured manifests carry (engine 2, C), each with
 * the type that carries it and that type's page path: what reads stored
 * events by their data's process type (the wire's redaction, the feed,
 * Activity) treats each as a manifest of its own.
 */
export const LEGACY_TYPES = MANIFEST_LIST.flatMap((m) =>
  (m.legacyTypes ?? []).map((l) => ({ ...l, carriedBy: m.descriptor.type, detailPath: m.detailPath })),
);
