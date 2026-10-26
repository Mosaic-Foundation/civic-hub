// The service layer's entry points that handlers call without importing
// processService (the process factory, the action dispatcher, the deadline
// closer). Their own module, importing only types, so processService can set
// them while the registry is still loading: a plugin package's imports reach
// processService during the registry's own load (ADR-014). The registry
// re-exports them.

import type { ProcessFactory, ActionDispatcher } from "./types.js";
import type { Process } from "../models/process.js";

/**
 * Process factory — set by the service layer at startup.
 * Allows handlers to create new processes without importing processService directly.
 */
let processFactory: ProcessFactory | null = null;

export function setProcessFactory(factory: ProcessFactory): void {
  processFactory = factory;
}

export function getProcessFactory(): ProcessFactory {
  if (!processFactory) {
    throw new Error("Process factory not initialized — service layer must call setProcessFactory()");
  }
  return processFactory;
}

/**
 * Action dispatcher — set by the service layer at startup (mirrors the process
 * factory). Lets handlers dispatch a persisted action (e.g. their close action
 * for lazy deadline-close) through executeAction without importing
 * processService directly.
 */
let actionDispatcher: ActionDispatcher | null = null;

export function setActionDispatcher(dispatcher: ActionDispatcher): void {
  actionDispatcher = dispatcher;
}

export function getActionDispatcher(): ActionDispatcher {
  if (!actionDispatcher) {
    throw new Error("Action dispatcher not initialized — service layer must call setActionDispatcher()");
  }
  return actionDispatcher;
}

/**
 * A deadline close, dispatched by a handler's closeIfExpired (vote,
 * conversation). Set by the service layer (processService.closeAtDeadline),
 * as the dispatcher is: one reader claims the close, the others return the
 * process as it is, and the claimed close runs through executeAction.
 */
export type DeadlineCloser = (process: Process, action: Parameters<ActionDispatcher>[1]) => Promise<Process>;
let deadlineCloser: DeadlineCloser | null = null;

export function setDeadlineCloser(closer: DeadlineCloser): void {
  deadlineCloser = closer;
}

export function closeThroughDispatcher(
  process: Process,
  action: Parameters<ActionDispatcher>[1],
): Promise<Process> {
  if (!deadlineCloser) {
    throw new Error("Deadline closer not initialized — service layer must call setDeadlineCloser()");
  }
  return deadlineCloser(process, action);
}

