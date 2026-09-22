// The resolved hub — and its settings — for the request currently being
// handled.
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
// The settings snapshot rides along with the hub because the two are always
// wanted together and because loading it once per request is what lets the
// readers stay synchronous. `isAdminEmail()` is called from fourteen places;
// an admin check that awaits its own query would put a round trip on every
// request that performs one.
//
// There is deliberately no setter. A hub is entered for the duration of a
// request and cannot be swapped underneath code that is already running.

import { AsyncLocalStorage } from "node:async_hooks";
import type { Hub } from "../models/hub.js";
import type { SettingsMap } from "../db/hubSettingsStore.js";

export interface HubScope {
  hub: Hub;
  /** Raw stored values for this hub. Decoding belongs to the service layer. */
  settings: SettingsMap;
}

const store = new AsyncLocalStorage<HubScope>();

/** Run `fn` with this hub and its settings as the current scope. */
export function runWithHub<T>(hub: Hub, settings: SettingsMap, fn: () => T): T {
  return store.run({ hub, settings }, fn);
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
  return store.getStore()?.hub ?? null;
}

/**
 * The settings snapshot for the request in flight, or null outside one.
 *
 * Raw and undecoded on purpose: callers go through src/services/hubSettings.ts,
 * which owns the alias map, the env fallbacks and the value encoding. Reading
 * this map directly would bypass all three.
 */
export function currentHubSettings(): SettingsMap | null {
  return store.getStore()?.settings ?? null;
}

/**
 * Run `fn` as if a request for this hub were in flight. For crons, scripts
 * and tests, which have no hostname but do know which hub they act for.
 */
export function withHubScope<T>(
  hub: Hub,
  settings: SettingsMap,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run({ hub, settings }, fn);
}

/**
 * The id of the hub serving this request.
 *
 * Throws outside a request, on purpose: a write that does not know which hub
 * it is for must not guess and must not silently land on hub #1. Read paths
 * that legitimately run outside a request use the `*Sync` readers, which fall
 * back to environment variables instead.
 */
export function currentHubId(): string {
  const hub = currentHub();
  if (!hub) {
    throw new Error(
      "No hub in scope. currentHubId() is only valid inside a request; " +
        "crons and scripts must pass a hub id explicitly.",
    );
  }
  return hub.id;
}

/**
 * The id of the hub serving this request, or null outside one.
 *
 * READ paths take this and pass it straight to the settings service, which
 * answers from environment variables when it is null. That is what lets a
 * cron, a script or a unit test call a reader without staging a fake request,
 * and it is why the readers take `string | null` rather than `string`.
 */
export function currentHubIdOrNull(): string | null {
  return currentHub()?.id ?? null;
}
