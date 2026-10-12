// The scope of one process action (executeAction), so its writes land
// together or not at all (Audit 3, A7).
//
// While a handler runs, the events it emits about the process it is acting
// on are HELD here, not written: executeAction writes them in the same
// transaction as the process's new state (transition_process, p_events), and
// only if that write wins. A close that loses a race to another close
// therefore leaves nothing in the log, where before it had already written
// its `ended` and `result_published` by the time it found out.
//
// Events about any OTHER process (a spawned record's `created`, say) are
// written at once, as before: they belong to rows the handler has already
// inserted.
//
// Work that must happen only once the action's write has won (rewriting a
// closed vote's ballots, say) is queued with afterActionCommits(). Outside an
// action it runs at once.

import { AsyncLocalStorage } from "node:async_hooks";
import type { CivicEvent } from "../models/event.js";

interface ActionScope {
  processId: string;
  events: CivicEvent[];
  afterCommit: Array<() => Promise<void>>;
}

const storage = new AsyncLocalStorage<ActionScope>();

/** Run `fn` as the handler of an action on `processId`, holding its events. */
export async function runInActionScope<T>(
  processId: string,
  fn: () => Promise<T>,
): Promise<{ value: T; events: CivicEvent[]; afterCommit: Array<() => Promise<void>> }> {
  const scope: ActionScope = { processId, events: [], afterCommit: [] };
  const value = await storage.run(scope, fn);
  return { value, events: scope.events, afterCommit: scope.afterCommit };
}

/**
 * Hold `event` for the action in progress when it is about that action's
 * process. True when held (the caller must not write it).
 */
export function holdForAction(event: CivicEvent): boolean {
  const scope = storage.getStore();
  if (!scope || scope.processId !== event.process_id) return false;
  scope.events.push(event);
  return true;
}

/** Run `fn` once the action in progress has written; at once outside one. */
export async function afterActionCommits(fn: () => Promise<void>): Promise<void> {
  const scope = storage.getStore();
  if (!scope) {
    await fn();
    return;
  }
  scope.afterCommit.push(fn);
}
