// A plugin switched off for a hub, at runtime.
//
// `plugin.<id>.enabled` is read per request from the hub in scope (it
// defaults to on, and its env fallback, where one exists, still applies).
// Off means, for that hub and no other:
//
//   - its routes answer 404 (requirePlugin, src/middleware/pluginGate.ts);
//   - its scheduled job is skipped (src/jobs/runJob.ts);
//   - its process types cannot be created (createProcess, submitForReview),
//     read or acted on by id, listed, or shown in the feed or the digest;
//   - its nav items and pages are gone (ui/src/config/plugins.ts).
//
// A type whose plugin package the loader did not mount (its hash has no
// approved catalog row; src/plugins/loader.ts) reads as switched off on every
// hub, in all the same ways.
//
// Nothing is deleted or rewritten. Every row stays as it was, so turning the
// plugin back on restores everything. The protocol surface, GET /events, is
// deliberately NOT filtered: it is the hub's published record, and what a hub
// published stays published.

import { ConflictError, NotFoundError } from "../errors/index.js";
import { isPluginEnabledSync, isPluginWindingDownSync } from "./hubSettings.js";
import { PROCESS_TYPE_PLUGINS, registeredProcessTypes } from "../processes/registry.js";
import type { PluginId } from "../models/hubSettings.js";
import { isTypeMounted } from "../plugins/mountedState.js";

/** Thrown when code asks to create a process whose plugin is off. */
export class PluginDisabledError extends NotFoundError {
  constructor(readonly plugin: PluginId, what: string) {
    super(`${what} is not available on this hub`, "plugin_disabled");
  }
}

export function isPluginDisabledError(err: unknown): err is PluginDisabledError {
  return err instanceof PluginDisabledError;
}

/** The plugin a process type belongs to; null for a type with none. */
export function processTypePlugin(type: string): PluginId | null {
  return PROCESS_TYPE_PLUGINS[type] ?? null;
}

/** Is this process type available on the hub in scope? Unknown types are. */
export function isProcessTypeEnabled(type: string): boolean {
  if (!isTypeMounted(type)) return false;
  const plugin = processTypePlugin(type);
  return plugin === null || isPluginEnabledSync(plugin);
}

/** The registered process types switched off on the hub in scope. */
export function disabledProcessTypes(): string[] {
  return Object.keys(PROCESS_TYPE_PLUGINS).filter((t) => !isProcessTypeEnabled(t));
}

/**
 * A type filter with the switched-off types taken out, for queries that take
 * one (search, link candidates). `null` asks for every type; it stays `null`
 * while nothing is off, and becomes the list of registered types that are on
 * otherwise. An empty result means nothing asked for is available.
 */
export function enabledProcessTypesAmong(requested: readonly string[] | null): string[] | null {
  const off = new Set(disabledProcessTypes());
  if (off.size === 0) return requested ? [...requested] : null;
  return (requested ?? registeredProcessTypes()).filter((t) => !off.has(t));
}

/**
 * Refuse to create (or, with `verb`, otherwise bring live) a process of a
 * type whose plugin is off.
 */
export function assertProcessTypeEnabled(type: string, verb = "Creating"): void {
  const plugin = processTypePlugin(type);
  if (plugin && (!isPluginEnabledSync(plugin) || !isTypeMounted(type))) {
    throw new PluginDisabledError(plugin, `${verb} ${type}`);
  }
}

/**
 * Refuse to start a new process of a type whose plugin is off, or winding
 * down (ADR-014): a resident's submission, an admin's creation, an approval
 * that would bring a submission live. A process the hub makes itself (a brief
 * on a close) goes through createProcess, which checks only the switch.
 */
export function assertProcessTypeCreatable(type: string, verb = "Creating"): void {
  assertProcessTypeEnabled(type, verb);
  const plugin = processTypePlugin(type);
  if (plugin && isPluginWindingDownSync(plugin)) {
    throw new ConflictError(
      "Nothing new of this kind can be started on this hub: it is winding down. What is already open runs to its close.",
      "plugin_winding_down",
    );
  }
}
