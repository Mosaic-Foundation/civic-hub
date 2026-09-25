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
// Nothing is deleted or rewritten. Every row stays as it was, so turning the
// plugin back on restores everything. The protocol surface, GET /events, is
// deliberately NOT filtered: it is the hub's published record, and what a hub
// published stays published.

import { isPluginEnabledSync } from "./hubSettings.js";
import { PROCESS_TYPE_PLUGINS } from "../processes/registry.js";
import type { PluginId } from "../models/hubSettings.js";

/** Thrown when code asks to create a process whose plugin is off. */
export class PluginDisabledError extends Error {
  readonly status = 404;
  readonly code = "plugin_disabled";
  constructor(readonly plugin: PluginId, what: string) {
    super(`${what} is not available on this hub`);
    this.name = "PluginDisabledError";
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
  const plugin = processTypePlugin(type);
  return plugin === null || isPluginEnabledSync(plugin);
}

/** The registered process types switched off on the hub in scope. */
export function disabledProcessTypes(): string[] {
  return Object.keys(PROCESS_TYPE_PLUGINS).filter((t) => !isProcessTypeEnabled(t));
}

/** Refuse to create a process of a type whose plugin is off. */
export function assertProcessTypeEnabled(type: string): void {
  const plugin = processTypePlugin(type);
  if (plugin && !isPluginEnabledSync(plugin)) {
    throw new PluginDisabledError(plugin, `Creating ${type}`);
  }
}
