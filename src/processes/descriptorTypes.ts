// The process type descriptor's types (src/processes/descriptor.ts has the
// runtime). Their own file, importing only plain types, so a process manifest
// (plain data the UI also reads and type-checks) reaches no server code
// (Architecture 2).

import type { ProcessStatus } from "../models/process.js";
import type { TypeDisplay } from "../shared/typeDisplay.js";

/**
 * Who may call an action through executeAction.
 *   resident: any signed-in resident;
 *   creator:  the resident who created the process (a project's Complete);
 *   admin:    a hub admin;
 *   official: a resident holding a public office (users.official_type, set
 *             by an admin; engine 2, A6), as the seam answers it;
 *   system:   the hub acting on its own (a deadline close, an approval's
 *             activation, a seed).
 * An admin may call anything a resident, creator or official may.
 */
export type DescriptorRole = "resident" | "creator" | "official" | "admin" | "system";

/**
 * Plugin architecture §2. Tier 1: first-party code in the hub's process.
 * Tier 2: sandboxed third-party code; no sandbox runtime exists yet, so no
 * descriptor may declare it (the conformance suite keeps a slot). Tier 3: an
 * external service the hub reaches through one adapter (§10a).
 */
export type TrustTier = 1 | 2 | 3;

/** A JSON Schema (draft 2020-12) object. `examples[0]` is what the conformance suite sends. */
export type JsonSchema = Record<string, unknown>;

export interface ActionDescriptor {
  /** What a caller passes as the action's type. */
  name: string;
  description: string;
  /** Who may call it. */
  callers: readonly DescriptorRole[];
  /** The `processes.status` values it may run from. */
  from: readonly ProcessStatus[];
  /**
   * The status it leaves the process in: one status, one of several (a poll
   * that may close), or null for "unchanged".
   */
  to: ProcessStatus | readonly ProcessStatus[] | null;
  /** The event types it emits about the process, beyond HOST_EVENT_TYPES. */
  emits: readonly string[];
  /**
   * Whether executeAction may run it again on a fresh read when another write
   * landed in between (Audit 3). Safe only when its every effect is its change
   * to the process row and the events written with it.
   */
  retry_safe?: boolean;
  /** The payload it accepts. `examples[0]` is a valid payload. */
  input_schema?: JsonSchema;
  /**
   * Each participant may do it once (Civic Process Specification §12.2): a
   * second call by the same person is refused with 409, however many arrive
   * at the same moment.
   */
  once_per_participant?: boolean;
}

/**
 * An outside service a Tier 3 type depends on (plugin architecture §10a),
 * declared so the conformance suite can check the hub's side of the contract
 * and report what does not meet it.
 */
export interface OutsideService {
  name: string;
  /** The one hub module that speaks the service's API (§10a.4). */
  adapter: string;
  /** The hub setting that holds the service's address (§4.1 network.egress). */
  egress_setting: string;
  /**
   * What the service is told about a participant (§10a.1).
   *   opaque_per_participant: a stable identifier made for the service alone;
   *   account_id: the hub's own account id (stable, but not opaque, and the
   *               same across every process).
   */
  participant_identifier: "opaque_per_participant" | "account_id";
  /**
   * How the hub authenticates to the service (§10a.1).
   *   per_participant: participant traffic carries a per-participant credential;
   *   shared_service_token: one long-lived token for every call, the
   *                         anti-pattern the spec names.
   */
  service_credential: "per_participant" | "shared_service_token";
  /** Whether the service itself refuses participants the hub did not allow (§10a.5). */
  service_allowlist: boolean;
  /** What participant data the service keeps (§10a.7). */
  data_retained: readonly string[];
  /** How that data leaves the service (§10a.7). */
  export_path: string;
  /**
   * The hub routes a resident takes part through, which reach the service
   * through the adapter (`:id` is the process id). The conformance suite
   * calls them to see what crosses the boundary per participant (§10a.1)
   * and that the hub decides who may take part (§10a.5).
   */
  participation: ReadonlyArray<{ method: "POST"; path: string; body: Record<string, unknown> }>;
}

export interface ProcessTypeDescriptor<P extends string = string> {
  type: string;
  version: string;
  tier: TrustTier;
  /** The plugin that switches this type on and off on a hub (a literal, so PluginId is derived). */
  plugin: P;
  /** The statuses its own lifecycle uses (HOST_STATES are implied). */
  states: readonly ProcessStatus[];
  /** The status createProcess gives a new one. */
  initial_status: ProcessStatus;
  actions: readonly ActionDescriptor[];
  /**
   * Every event type it emits, inside actions or not (its module's own
   * routes), beyond HOST_EVENT_TYPES: §4.1 `activities.emit`.
   */
  emits: readonly string[];
  /** How a process of this type comes into being. */
  creation: {
    /**
     * A resident drafts one: the API path of its drafts. Null: residents
     * cannot create it. `publish_at_once`: who else skips the review wait
     * beside an admin (engine 2, A6): "official" for a type whose officials
     * publish directly (Events).
     */
    resident: { drafts: string; publish_at_once?: readonly "official"[] } | null;
    /** An admin creates one directly. */
    admin: boolean;
    /** The hub creates one itself (a brief on close, a meeting summary job). */
    system: boolean;
  };
  /** A deadline the hub closes it at, and the action that does it. Null: no deadline. */
  deadline: { action: string; source: string } | null;
  /** Whether it produces a Civic Brief when it closes (generateBrief). */
  brief: boolean;
  /** The tables it owns beyond `processes`. */
  tables: readonly string[];
  /** Tier 3: the services it reaches. */
  outside_services: readonly OutsideService[];
  /**
   * What the conformance suite sends to make one (kit/conformance/). A
   * plugin author supplies these so the suite can drive the type with no
   * type-specific test code:
   *   draft:  the fields of a submittable draft, for a type residents draft
   *           (PATCHed onto a new draft at creation.resident.drafts);
   *   create: the request an admin makes to create one directly (POST to
   *           `path`, default /process).
   */
  examples: {
    draft?: Record<string, unknown>;
    create?: { path?: string; body: Record<string, unknown> };
  };
  /** How the hub's pages name and place it (navigation slice, 2026-10-14). */
  display: TypeDisplay;
}
