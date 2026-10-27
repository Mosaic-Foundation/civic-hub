// The process type manifest: everything one process type is, in one place
// (Architecture 2, 2026-10-21; ADR-009).
//
// Each type's folder has a `manifest.ts` exporting one ProcessManifest. The
// registry, the plugin ids, the tables a hub owns and exports, the activity
// mappings, the scheduled jobs, the Plugins settings section, the feed, the
// public list and the UI's labels and colours are all built from the loaded
// manifests (src/shared/processManifests.ts lists them; loadManifests() below
// checks them at startup). Adding a type is adding a folder with a manifest
// and a handler, and one line in that list.
//
// A manifest is plain data. It imports types, and values only from
// src/shared/, so the UI can read it too (eslint `civic/manifest-pure`). The
// handler (the code that runs actions) is paired with it by the registry.

import type { ProcessTypeDescriptor } from "./descriptorTypes.js";
import type { SchemaRequirement } from "../db/schemaRequirement.js";
import type { SettingFieldSpec } from "../shared/hubSettingsSections.js";
import type { ThemeTypeKey } from "../shared/theme.js";
import type { ActivityRecipe } from "../shared/activityRecipe.js";
import type { FeedDeclaration } from "../shared/feedActivity.js";
import { grantProblem, type PluginCapabilities } from "../shared/pluginGrant.js";
import { participationProblem, type ParticipationDeclaration } from "../shared/participation.js";

/**
 * One scheduled job of a type: src/jobs/registry.ts's HubJobSpec, with the
 * plugin as a plain string (PluginId is derived from the manifests, so it
 * cannot be used inside one). checkManifests requires it to be the type's.
 */
export interface ManifestJob {
  readonly id: string;
  readonly plugin: string;
  readonly path: string;
  readonly schedule: string;
  readonly description: string;
  readonly deprecatedPaths?: readonly string[];
}

/** One table a type owns beyond `processes`: what a hub export does with it, and its key. */
export interface TableDeclaration {
  name: string;
  /** "export": its rows leave with a hub export; "omit": they must not (say why). */
  rows: "export" | "omit";
  /** Why a table is omitted. Required when rows is "omit". */
  reason?: string;
  /** Its primary key, in key order (the order rows are read and written). */
  key: readonly string[];
  /** A table nothing writes any more, kept because a hub's history holds rows in it. */
  legacy?: true;
  /**
   * What its rows are, in plain words, completing "Keep its own records on
   * this hub: …" on the Install confirmation ("residents' one-word answers").
   */
  holds: string;
}

/** The admin queues a type's unpublished records can wait in (src/services/adminQueues.ts). */
export type PublicationQueue = "briefs" | "meeting_summaries";

/**
 * A type whose records an admin publishes before residents see them (a brief,
 * a vote's results, a meeting summary). `field` is the state (and read-model)
 * field that says where a record is: "pending" waits in `queue`, "published"
 * is public. Until published, a record is not in the public process list.
 */
export interface Publication {
  field: string;
  queue: PublicationQueue;
  /**
   * false: an unpublished record's page answers 404 for everyone, so a link
   * to one is not shown (a brief). Default true.
   */
  linkedBeforePublished?: false;
}

/**
 * The plugin's own part of the Plugins settings section, carried by the one
 * manifest that owns the plugin (a vote's results belong to the vote plugin,
 * so only the vote's manifest carries it).
 */
export interface PluginSection {
  /** Its place in the Plugins section (lower first; hub features share the scale). */
  order: number;
  /** What the Plugins page and the console call the plugin: "Votes". */
  name: string;
  /** One line on the Plugins page saying what it is. */
  what: string;
  /** Its settings beyond `plugin.<id>.enabled`, which every plugin has. */
  fields: readonly SettingFieldSpec[];
}

export interface ProcessManifest {
  /**
   * What the type is: lifecycle, actions and who may call each, the events it
   * emits, how one comes into being, its plugin and its display (label,
   * plural, icon, section with its short label). `actions[].callers` is the
   * resident allowlist (audit A3): residentActions() derives it.
   */
  descriptor: ProcessTypeDescriptor;
  /** The theme colour family its pills and cards take (src/shared/theme.ts). */
  color: ThemeTypeKey;
  /** The canonical public UI path of one of its processes. */
  detailPath(id: string): string;
  /** The tables and columns it needs, checked at startup and by /health. */
  requiredSchema: readonly SchemaRequirement[];
  /** The tables it owns beyond `processes`. */
  tables: readonly TableDeclaration[];
  /** Its scheduled jobs (their `plugin` is the type's plugin). */
  jobs: readonly ManifestJob[];
  /** Present on the manifest that owns its plugin. */
  pluginSection?: PluginSection;
  /**
   * The AS2 mapping of each event type in its own namespace (civic.proposal.*,
   * civic.project.*). Shared event types (civic.process.*) are the host's
   * (src/events/activitySerializer.ts) and are not repeated here.
   */
  activities: Readonly<Record<string, ActivityRecipe>>;
  /**
   * Event types it has emitted in the past and no longer does, mapped so a
   * stored event stays serializable forever (the log is append-only).
   */
  legacyActivities?: Readonly<Record<string, ActivityRecipe>>;
  /** Present when an admin publishes its records (see Publication). */
  publication?: Publication;
  /**
   * Present when one of its processes summarizes another (a brief): the
   * state field naming the process it summarizes. Links and the "Read the
   * brief" pointer go through it.
   */
  summarizes?: { stateField: string };
  /**
   * How its Civic Brief's pill reads. "to_board": "Brief to the
   * Supervisors", worded for the hub's governing body (a vote's). Default:
   * the feed's own pill.
   */
  briefPill?: "to_board";
  /**
   * For a type with a deadline: the refusal an action gets once the deadline
   * has passed and before the hourly job closes it — the same code and
   * message the type gives a closed one (a vote's "vote_closed").
   */
  deadlineRefusal?: { code: string; message: string };
  /**
   * The feed cards its events make, and how a Civic Brief of one of its
   * processes reads (src/shared/feedActivity.ts). Absent: it makes no cards.
   */
  feed?: FeedDeclaration;
  /**
   * The payload fields of each event type that are PUBLIC — what `hub:payload`
   * may carry on the wire for a member or public reader (Architecture 3,
   * ADR-010; Adam, 2026-10-21). Keyed by event type, each entry listing
   * top-level payload keys; a declared key keeps its whole subtree. The host
   * always serves `data.process` (and a few host-owned keys, see
   * src/events/publicPayload.ts), so `process` is not repeated here. An event
   * type with no entry publishes `process` and nothing else; an undeclared
   * field is dropped at serve time, never at storage. Admins are served the
   * stored payload verbatim.
   */
  publicPayload: Readonly<Record<string, readonly string[]>>;
  /**
   * Who a participant's name is disclosed to, decided by the process's
   * declared policy rather than by whether the reader signed in
   * (Architecture 3, ADR-010; Adam, 2026-10-21, Q6):
   *   - "anonymous": no reader below admin sees names — members included
   *     (ballots, conversation statements, word submissions);
   *   - "members": names to signed-in members only, as residents understood
   *     when they posted (proposals, projects);
   *   - "public": names to every reader, signed in or not — the public
   *     record (announcements, briefs, meeting summaries).
   * Account ids are never disclosed below admin, whatever the policy.
   */
  disclosure: "anonymous" | "members" | "public";
  /**
   * True when one of this type's processes may declare its own disclosure
   * policy (state.disclosure_policy), overriding the default above. The
   * serving layer honours it only when the manifest allows it here.
   */
  disclosureOverridable?: true;
  /**
   * Who may take part, when it is stricter than the hub's own rule
   * (Architecture 4, ADR-011; process spec §12.1 `eligibility_requirements`).
   * Absent — every type today — a process inherits the hub's rule: residency
   * affirmed on the hub, and a real name on file (src/authz/eligibility.ts).
   * Present, each entry names a credential type the participant must hold, in
   * the identity spec's §8.1 conjunction (every entry; an entry that is itself
   * a list is satisfied by any one of its members); the descriptor serves the
   * list, and the seam refuses a participant who does not hold them. No
   * credential can be presented yet, so a type that declares one admits
   * nobody but admins until the identity layer can verify credentials.
   */
  eligibility?: { requirements: readonly (string | readonly string[])[] };
  /**
   * What its code may touch (plugin architecture §4.1; ADR-014): the event
   * types it emits, its tables, the adapters it calls, the identity claims it
   * is told and the UI surfaces it draws on (src/shared/pluginGrant.ts). The
   * catalog records it when the operator approves the package, a hub records
   * it at install, and the hub's seams refuse anything beyond it.
   */
  capabilities: PluginCapabilities;
  /**
   * Which of its events count as a resident taking part, which create, close
   * and record the outcome of one of its processes, and the funder measures
   * they feed (the analytics slice, ADR-016; src/shared/participation.ts).
   * The hub counts every type from this alone. Optional to load (a type
   * without one is counted as undeclared); the conformance suite requires it.
   */
  participation?: ParticipationDeclaration;
}

/**
 * Declare a type's descriptor. Returns it as given, keeping its plugin id as
 * a literal (PluginId is the union of the manifests' plugins and the hub
 * features).
 */
export function defineDescriptor<const P extends string>(descriptor: ProcessTypeDescriptor<P>): ProcessTypeDescriptor<P> {
  return descriptor;
}

/**
 * Declare a manifest. Returns it as given, keeping its literal values (its
 * table names become part of forHub's TableName type).
 */
export function defineManifest<const M extends ProcessManifest>(manifest: M): M {
  return manifest;
}

/** Why a manifest was refused at startup. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

const REQUIRED: ReadonlyArray<keyof ProcessManifest> = [
  "descriptor",
  "color",
  "detailPath",
  "requiredSchema",
  "tables",
  "jobs",
  "activities",
  "publicPayload",
  "disclosure",
  "capabilities",
];

/** The disclosure policies a manifest (or a process override) may declare. */
export const DISCLOSURE_POLICIES = ["anonymous", "members", "public"] as const;
export type DisclosurePolicy = (typeof DISCLOSURE_POLICIES)[number];

/** What a manifest is checked against that only the host knows. */
export interface ManifestHostFacts {
  /** The theme colour families (THEME_TYPE_KEYS). */
  colors: readonly string[];
  /** Event types the host maps for every type (civic.process.*, review, hub). */
  hostActivityTypes: readonly string[];
  /** Tables the host owns (processes, events, users, ...). */
  hostTables: readonly string[];
  /** Hub feature ids (not process plugins). */
  featureIds: readonly string[];
}

/**
 * Check every manifest and refuse the set at the first problem, naming the
 * type and the field, so a hub with a broken plugin does not start. Pure.
 */
export function checkManifests(manifests: readonly unknown[], host: ManifestHostFacts): ProcessManifest[] {
  const seenTypes = new Set<string>();
  const seenTables = new Set<string>(host.hostTables);
  const seenActivities = new Set<string>(host.hostActivityTypes);
  const pluginOwners = new Map<string, string>();
  const pluginsUsed = new Set<string>();

  manifests.forEach((raw, i) => {
    const where = (m: Partial<ProcessManifest>) =>
      `process manifest ${typeof m?.descriptor?.type === "string" ? m.descriptor.type : `#${i + 1}`}`;
    if (!raw || typeof raw !== "object") throw new ManifestError(`process manifest #${i + 1}: not an object`);
    const m = raw as Partial<ProcessManifest>;
    for (const field of REQUIRED) {
      if (m[field] === undefined || m[field] === null) {
        throw new ManifestError(`${where(m)}: missing "${field}"`);
      }
    }
    const d = m.descriptor!;
    if (typeof d.type !== "string" || !/^[a-z]+\.[a-z_]+$/.test(d.type)) {
      throw new ManifestError(`${where(m)}: descriptor.type must look like "civic.vote"`);
    }
    if (seenTypes.has(d.type)) throw new ManifestError(`${where(m)}: a second manifest declares this type`);
    seenTypes.add(d.type);
    if (typeof d.plugin !== "string" || (d.plugin as string) === "") throw new ManifestError(`${where(m)}: missing "descriptor.plugin"`);
    if (host.featureIds.includes(d.plugin)) {
      throw new ManifestError(`${where(m)}: plugin "${d.plugin}" is a hub feature, not a process plugin`);
    }
    pluginsUsed.add(d.plugin);
    if (!d.display || typeof d.display.label !== "string" || typeof d.display.plural !== "string") {
      throw new ManifestError(`${where(m)}: missing "descriptor.display" label or plural`);
    }
    if (!host.colors.includes(m.color as string)) {
      throw new ManifestError(`${where(m)}: color "${String(m.color)}" is not a theme colour (${host.colors.join(", ")})`);
    }
    if (typeof m.detailPath !== "function") throw new ManifestError(`${where(m)}: "detailPath" must be a function`);
    const path = m.detailPath("p_x");
    if (typeof path !== "string" || !path.startsWith("/") || !path.includes("p_x")) {
      throw new ManifestError(`${where(m)}: detailPath(id) must return a path containing the id`);
    }

    const tableNames = new Set<string>();
    for (const t of m.tables!) {
      if (!t || typeof t.name !== "string") throw new ManifestError(`${where(m)}: a table has no name`);
      if (seenTables.has(t.name)) throw new ManifestError(`${where(m)}: table ${t.name} is already owned`);
      if (t.rows !== "export" && t.rows !== "omit") throw new ManifestError(`${where(m)}: table ${t.name}: rows must be "export" or "omit"`);
      if (t.rows === "omit" && !t.reason) throw new ManifestError(`${where(m)}: table ${t.name} is omitted from exports without a reason`);
      if (!Array.isArray(t.key) || t.key.length === 0) throw new ManifestError(`${where(m)}: table ${t.name} has no primary key`);
      if (typeof t.holds !== "string" || t.holds.trim() === "") throw new ManifestError(`${where(m)}: table ${t.name} needs "holds", what its rows are in plain words`);
      seenTables.add(t.name);
      tableNames.add(t.name);
    }
    const live = m.tables!.filter((t) => !t.legacy).map((t) => t.name).sort();
    const declared = [...d.tables].sort();
    if (JSON.stringify(live) !== JSON.stringify(declared)) {
      throw new ManifestError(`${where(m)}: descriptor.tables (${declared.join(", ")}) and its live tables (${live.join(", ")}) differ`);
    }

    for (const j of m.jobs!) {
      if (j.plugin !== d.plugin) throw new ManifestError(`${where(m)}: job ${j.id} belongs to plugin ${String(j.plugin)}, not ${d.plugin}`);
    }

    for (const [eventType, set] of [
      ...Object.keys(m.activities!).map((k) => [k, "activities"] as const),
      ...Object.keys(m.legacyActivities ?? {}).map((k) => [k, "legacyActivities"] as const),
    ]) {
      if (seenActivities.has(eventType)) throw new ManifestError(`${where(m)}: ${set}: ${eventType} is already mapped`);
      seenActivities.add(eventType);
    }
    for (const eventType of Object.keys(m.activities!)) {
      if (!d.emits.includes(eventType)) {
        throw new ManifestError(`${where(m)}: maps ${eventType}, which its descriptor does not emit (legacy types go in legacyActivities)`);
      }
    }

    // Host lifecycle types (created, updated, ...) are emitted for every type
    // without appearing in a descriptor's emits, so they may be declared too.
    const known = new Set<string>([
      ...d.emits,
      ...Object.keys(m.activities!),
      ...Object.keys(m.legacyActivities ?? {}),
      ...host.hostActivityTypes,
    ]);
    for (const [eventType, keys] of Object.entries(m.publicPayload!)) {
      if (!known.has(eventType)) {
        throw new ManifestError(
          `${where(m)}: publicPayload declares ${eventType}, which the type neither emits nor maps`,
        );
      }
      if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string" || k === "" || k === "process")) {
        throw new ManifestError(
          `${where(m)}: publicPayload.${eventType} must list non-empty payload keys ("process" is always public and not repeated)`,
        );
      }
    }

    const grant = grantProblem(m.capabilities, {
      emits: d.emits,
      tables: m.tables!.map((t) => t.name),
      tier: d.tier,
    });
    if (grant) throw new ManifestError(`${where(m)}: ${grant}`);

    if (!DISCLOSURE_POLICIES.includes(m.disclosure as DisclosurePolicy)) {
      throw new ManifestError(
        `${where(m)}: disclosure "${String(m.disclosure)}" must be one of ${DISCLOSURE_POLICIES.join(", ")}`,
      );
    }

    if (m.participation !== undefined) {
      const problem = participationProblem(m.participation, { emits: d.emits, hostTypes: host.hostActivityTypes });
      if (problem) throw new ManifestError(`${where(m)}: ${problem}`);
    }

    if (m.eligibility !== undefined) {
      const reqs = (m.eligibility as { requirements?: unknown }).requirements;
      const isName = (v: unknown) => typeof v === "string" && v.trim() !== "";
      if (
        !Array.isArray(reqs) ||
        reqs.length === 0 ||
        reqs.some((r) => !(isName(r) || (Array.isArray(r) && r.length > 0 && r.every(isName))))
      ) {
        throw new ManifestError(
          `${where(m)}: eligibility.requirements must be a non-empty list of credential types (or lists of alternatives)`,
        );
      }
    }

    if (m.publication) {
      const pub = m.publication;
      if (typeof pub.field !== "string" || pub.field === "") throw new ManifestError(`${where(m)}: publication.field is empty`);
      if (pub.queue !== "briefs" && pub.queue !== "meeting_summaries") {
        throw new ManifestError(`${where(m)}: publication.queue must be "briefs" or "meeting_summaries"`);
      }
    }
    if (d.deadline && (!m.deadlineRefusal || !m.deadlineRefusal.code || !m.deadlineRefusal.message)) {
      throw new ManifestError(`${where(m)}: a type with a deadline needs "deadlineRefusal" (code and message)`);
    }
    if (m.summarizes && (typeof m.summarizes.stateField !== "string" || m.summarizes.stateField === "")) {
      throw new ManifestError(`${where(m)}: summarizes.stateField is empty`);
    }

    if (m.pluginSection) {
      const owner = pluginOwners.get(d.plugin);
      if (owner) throw new ManifestError(`${where(m)}: plugin ${d.plugin}'s section is already carried by ${owner}`);
      pluginOwners.set(d.plugin, d.type);
      if (!m.pluginSection.name || !m.pluginSection.what) {
        throw new ManifestError(`${where(m)}: pluginSection needs a name and a "what" line`);
      }
      for (const f of m.pluginSection.fields) {
        if (!f.key.startsWith(`plugin.${d.plugin}.`)) {
          throw new ManifestError(`${where(m)}: setting ${f.key} is not under plugin.${d.plugin}.`);
        }
      }
    }
  });

  for (const plugin of pluginsUsed) {
    if (!pluginOwners.has(plugin)) {
      throw new ManifestError(`process plugin ${plugin}: no manifest carries its pluginSection`);
    }
  }
  return manifests as ProcessManifest[];
}

/** The actions a resident may call, from the descriptor's callers (the A3 allowlist). */
export function residentActions(m: Pick<ProcessManifest, "descriptor">): string[] {
  return m.descriptor.actions.filter((a) => a.callers.includes("resident")).map((a) => a.name);
}
