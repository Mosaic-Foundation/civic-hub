// The resolved hub for the request currently being handled.
//
// Hub identity used to be a deployment-wide constant read from env, so every
// helper that needed it could just read process.env. With one deployment
// serving many hubs it varies per request, and threading it through every
// call site would mean changing hundreds of signatures for a value that is
// ambient by nature.
//
// AsyncLocalStorage is the mechanism Node provides for exactly this: the
// middleware enters a store once, and anything the request goes on to do —
// however deep, however async — reads the same hub back out.
//
// There is deliberately no setter. A hub is entered for the duration of a
// request and cannot be swapped underneath code that is already running.

import { AsyncLocalStorage } from "node:async_hooks";
import type { Hub } from "../models/hub.js";

const store = new AsyncLocalStorage<Hub>();

/** Run `fn` with `hub` as the current hub for everything it does. */
export function runWithHub<T>(hub: Hub, fn: () => T): T {
  return store.run(hub, fn);
}

/**
 * The hub for the request in flight, or null when there is no request in
 * scope — a cron, a script, a test, or module-level code at boot.
 *
 * Callers must handle null rather than assume a hub. Until Phase 2 converts
 * the cron routes and scripts to iterate hubs explicitly, the config helpers
 * fall back to environment variables in that case, which is what keeps the
 * single-hub self-host path working unchanged.
 */
export function currentHub(): Hub | null {
  return store.getStore() ?? null;
}
