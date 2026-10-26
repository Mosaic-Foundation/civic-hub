// Process registry — maps process types to their handlers.
//
// This registry enables a plugin-style architecture for civic processes.
// Each process type (e.g. civic.vote, civic.proposal) implements a handler.
// Future work may allow dynamic loading, but for now this is static.

// First, so processService can set the slots during a package's load.
export {
  setProcessFactory,
  getProcessFactory,
  setActionDispatcher,
  getActionDispatcher,
  setDeadlineCloser,
  closeThroughDispatcher,
} from "./serviceSlots.js";

import { ValidationError } from "../errors/index.js";
import { ProcessHandler, ProcessFactory, ActionDispatcher } from "./types.js";
import type { ApprovalActivation } from "./types.js";
import {
  registerDescriptor,
  publicDescriptor,
  type ActionDescriptor,
  type ProcessTypeDescriptor,
  type PublicProcessType,
} from "./descriptor.js";
import type { ProcessTypeDisplay } from "../shared/typeDisplay.js";

export type { ProcessTypeDisplay };
import type { Process } from "../models/process.js";
import type { PluginId } from "../models/hubSettings.js";
import proposalAdapter from "../modules/civic.proposals/handler.js";
import projectAdapter from "../modules/civic.projects/handler.js";
import voteResultsProcess from "../modules/civic.vote_results/handler.js";
import briefProcess from "../modules/civic.brief/handler.js";
import announcementProcess from "../modules/civic.announcement/handler.js";
import meetingSummaryProcess from "../modules/civic.meeting_summary/handler.js";
import { bootDeliberation } from "./deliberationBoot.js";
import {
  describeSubmissionFields,
  type SubmissionField,
  type SubmissionSource,
} from "../shared/submissionPreview.js";
import { PROCESS_MANIFESTS } from "../shared/processManifests.js";
import { THEME_TYPE_KEYS } from "../shared/theme.js";
import {
  checkManifests,
  ManifestError,
  type ProcessManifest,
  type Publication,
  type PublicationQueue,
} from "./manifest.js";
import { HOST_TABLES } from "../db/forHub.js";
import { HUB_FEATURE_IDS } from "../shared/hubFeatures.js";
import { hostMappedEventTypes } from "../events/activitySerializer.js";
import { loadedPackages } from "../plugins/loader.js";
import { configuredPackageOfType } from "../plugins/mountedState.js";

// civic.vote_results + civic.announcement + civic.meeting_summary are
// registered here but can be omitted by hubs that don't want those
// capabilities. When civic.vote_results is present, the vote adapter
// spawns a vote-results record on close; when absent, vote closes
// terminate without a published results page. civic.announcement is
// entirely self-contained via /announcement routes.
// civic.meeting_summary is self-contained via /meeting-summary and
// /admin/meeting-summaries, plus the cron endpoint at
// /internal/meeting-summary/run — a hub that omits this module simply
// doesn't mount those routes and nothing else breaks.
//
// Historical note: the civic.vote_results module was named civic.brief
// through Slice 8. Slice 8.5 renamed it to align the codebase with the
// user-facing concept ("Vote results"). Existing process rows are
// migrated by 20260427000000_rename_civic_brief_to_vote_results.sql.
//
// Since Architecture 2 (ADR-009) the types are their manifests
// (src/shared/processManifests.ts), checked at startup; each is paired here
// with the handler that runs its actions. The plugin packages' handlers come
// from the loader (ADR-014); the pairing is made on first use, because a
// package's own imports reach this module while the loader is still loading
// it. src/app.ts asks for it at startup, so a bad pairing still stops the start.
// The handlers not yet in packages and the packages' are listed in the
// manifests' order.
const deliberationHandler = bootDeliberation();
const handlers = (): readonly ProcessHandler[] => {
  const rank = new Map(MANIFESTS.map((m, i) => [m.descriptor.type, i]));
  return [
    proposalAdapter,
    projectAdapter,
    voteResultsProcess,
    briefProcess,
    announcementProcess,
    meetingSummaryProcess,
    deliberationHandler,
    ...loadedPackages().map((p) => p.server.handler),
  ].sort((a, b) => (rank.get(a.type) ?? Infinity) - (rank.get(b.type) ?? Infinity) || 0);
};

const MANIFESTS = withPackageNames(() =>
  checkManifests(PROCESS_MANIFESTS, {
    colors: THEME_TYPE_KEYS,
    hostActivityTypes: hostMappedEventTypes(),
    hostTables: HOST_TABLES,
    featureIds: HUB_FEATURE_IDS,
  }),
);

/** A refused manifest's message, naming the package that carries the type (ADR-014). */
function withPackageNames<T>(check: () => T): T {
  try {
    return check();
  } catch (err) {
    const type = err instanceof ManifestError ? /^process manifest ([a-z]+\.[a-z_]+)/.exec(err.message)?.[1] : undefined;
    const pkg = type ? configuredPackageOfType(type) : undefined;
    if (pkg) throw new ManifestError(`plugin package ${pkg.name} (${pkg.dir}): ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/** Each manifest with its handler, in the manifests' order; a manifest without one, or a stray handler, stops startup. */
function pair(manifests: readonly ProcessManifest[], handlers: readonly ProcessHandler[]): Record<string, ProcessHandler> {
  const byType = new Map(handlers.map((h) => [h.type, h]));
  const out: Record<string, ProcessHandler> = {};
  for (const m of manifests) {
    const handler = byType.get(m.descriptor.type);
    if (!handler) throw new ManifestError(`process manifest ${m.descriptor.type}: no handler is registered for it`);
    if (handler.descriptor !== m.descriptor) {
      throw new ManifestError(`process manifest ${m.descriptor.type}: its handler declares another descriptor`);
    }
    out[m.descriptor.type] = handler;
    byType.delete(m.descriptor.type);
  }
  for (const type of byType.keys()) throw new ManifestError(`handler ${type}: no manifest declares this type`);
  return out;
}

let paired: Record<string, ProcessHandler> | null = null;

/** Every type's handler, paired with its manifest on first use. */
function processRegistryNow(): Record<string, ProcessHandler> {
  return (paired ??= pair(MANIFESTS, handlers()));
}

/** Every loaded manifest, in registry order. */
export function getManifests(): readonly ProcessManifest[] {
  return MANIFESTS;
}

/** A registered type's manifest. */
export function getManifest(type: string): ProcessManifest | undefined {
  return MANIFESTS.find((m) => m.descriptor.type === type);
}

/** How a type's records are published by an admin, or undefined when they are public as made. */
export function publicationOf(type: string): Publication | undefined {
  return getManifest(type)?.publication;
}

/** The types whose unpublished records wait in an admin queue, in registry order. */
export function typesPublishedThrough(queue: PublicationQueue): string[] {
  return MANIFESTS.filter((m) => m.publication?.queue === queue).map((m) => m.descriptor.type);
}

/**
 * Whether a record is published: always for a type an admin does not
 * publish; otherwise its publication field (on its state or its read model)
 * says "published".
 */
export function isPublished(type: string, fields: Record<string, unknown> | null | undefined): boolean {
  const pub = publicationOf(type);
  return !pub || fields?.[pub.field] === "published";
}

/** The process a process of this type summarizes (a brief's source), or null. */
export function summarizedProcessIdOf(type: string, state: Record<string, unknown> | null | undefined): string | null {
  const field = getManifest(type)?.summarizes?.stateField;
  const id = field ? state?.[field] : undefined;
  return typeof id === "string" && id !== "" ? id : null;
}

// Each handler's descriptor is the one declaration of what its type is
// (src/processes/descriptor.ts). Registered here for the emission path's
// Stage 1 check, and read below for everything that used to be listed by hand.
for (const m of MANIFESTS) registerDescriptor(m.descriptor);

/**
 * The plugin each process type belongs to (BUILD-PLAN-multi-tenant.md,
 * `plugin.<id>.` ids), from each type's descriptor. `plugin.<id>.enabled` off
 * on a hub means that hub cannot create the type, cannot read or act on one
 * by id, and does not list or feed it — while every existing row stays
 * exactly as it is, so turning the plugin back on loses nothing. See
 * src/services/pluginGate.ts. `civic.vote_results` is the pre-brief results
 * record a vote produced, so it belongs to votes.
 */
export const PROCESS_TYPE_PLUGINS: Readonly<Record<string, PluginId>> = Object.fromEntries(
  // PluginId is the union of the manifests' plugins, so each is one.
  MANIFESTS.map((m) => [m.descriptor.type, m.descriptor.plugin as PluginId]),
);

/** A registered type's descriptor. */
export function getDescriptor(type: string): ProcessTypeDescriptor | undefined {
  return processRegistryNow()[type]?.descriptor;
}

/** One action of a registered type, as its descriptor declares it. */
export function declaredAction(type: string, action: string): ActionDescriptor | undefined {
  return processRegistryNow()[type]?.descriptor.actions.find((a) => a.name === action);
}

/**
 * The actions a resident may call through `POST /process/:id/action`: the
 * Audit 1 allowlist, now read from the descriptor. Any action not named here
 * needs an admin, the process's creator (where the descriptor says so), or the
 * hub itself.
 */
export function residentActionsOf(type: string): string[] {
  return (getDescriptor(type)?.actions ?? [])
    .filter((a) => a.callers.includes("resident"))
    .map((a) => a.name);
}

/** The actions executeAction may run again after a conflict (Audit 3). */
export function retrySafeActionsOf(type: string): string[] {
  return (getDescriptor(type)?.actions ?? []).filter((a) => a.retry_safe).map((a) => a.name);
}

/**
 * The public parts of every registered type's descriptor (GET
 * /.well-known/civic.json), narrowed by the caller to the types a hub has on.
 */
export function publicProcessTypes(include: (type: string) => boolean): PublicProcessType[] {
  return Object.values(processRegistryNow())
    .filter((h) => include(h.type))
    .map((h) => publicDescriptor(h.descriptor));
}

/**
 * Every registered type's display, switched on or not: the UI decides what to
 * draw from the hub's plugin switches, and labels are not secret. The order is
 * the registry's; sections carry their own default order.
 */
export function processTypeDisplays(): ProcessTypeDisplay[] {
  return Object.values(processRegistryNow()).map((h) => ({
    type: h.type,
    plugin: h.descriptor.plugin,
    ...h.descriptor.display,
  }));
}

/** Every registered process type, for checks that must cover all of them. */
export function registeredProcessTypes(): string[] {
  return Object.keys(processRegistryNow());
}

/**
 * Look up the handler for a given process type.
 * Returns undefined if no handler is registered.
 */
export function getProcessHandler(type: string): ProcessHandler | undefined {
  return processRegistryNow()[type];
}

/** List all registered process types */
export function getRegisteredTypes(): string[] {
  return Object.keys(processRegistryNow());
}

/**
 * Every registered handler. Used by the schema contract to collect the
 * storage each enabled process type declares — a hub that omits a module
 * drops that module's expectations along with it.
 */
export function getAllHandlers(): ProcessHandler[] {
  return Object.values(processRegistryNow());
}

/**
 * The canonical public UI path for a process, resolved from its handler.
 *
 * The single place the app turns (type, id) into a link. Handlers declare
 * `detailPath`; anything without one — including a type this hub does not
 * have registered at all — falls back to the generic process route, which
 * always resolves. Callers (link cards, search hits) therefore never need to
 * know which process types exist.
 */
export function processDetailPath(type: string, id: string): string {
  const handler = processRegistryNow()[type];
  return handler?.detailPath?.(id) ?? `/process/${id}`;
}

/**
 * Everything the creator submitted, as displayable fields — for the review
 * previews (creator + admin). Handlers may extend the generic default via
 * `describeSubmission`; a type without one — including a type registered
 * tomorrow — gets the generic walk of its `content` block, so nothing it
 * submits is hidden. See src/shared/submissionPreview.ts.
 */
/** Where a creator revises one of this type's drafts, or null when the type
 *  declares no drafting page. */
export function draftPathFor(type: string, draftId: string): string | null {
  return processRegistryNow()[type]?.draftPath?.(draftId) ?? null;
}

/** Put a submitted draft back into "drafting" through its type's handler. */
export async function reopenDraftForRevision(type: string, draftId: string): Promise<void> {
  const handler = processRegistryNow()[type];
  if (!handler?.reopenDraft) {
    throw new ValidationError("This kind of process can't be revised after it is submitted.", "revision_not_supported");
  }
  await handler.reopenDraft(draftId);
}

/**
 * What approving a process of this type should do to it. Handlers declare
 * `activationOnApproval`; anything without one — including a type registered
 * tomorrow — is published straight to "active" with no lifecycle action, so
 * approval always means something definite rather than nothing at all.
 *
 * The review service is the only caller. It never asks what type it holds.
 */
export function activationOnApproval(process: Process): ApprovalActivation {
  const handler = processRegistryNow()[process.definition.type];
  return handler?.activationOnApproval?.(process) ?? { status: "active" };
}

export function describeSubmission(source: SubmissionSource): SubmissionField[] {
  const handler = processRegistryNow()[source.type];
  return handler?.describeSubmission?.(source) ?? describeSubmissionFields(source);
}
