// Run a scheduled job once per hub, inside that hub's scope.
//
// A cron has no hostname, so before this existed the plugin crons ran with no
// hub in scope and every settings read fell through to environment variables —
// one deployment-wide answer to "whose meetings, whose news". That was only
// ever right while one deployment served one hub. A job that reads a hub's
// configuration must be told which hub it is running for, and then read that
// hub's rows and nobody else's.
//
// Each hub runs inside `withHubScope`, exactly as a request for it would, so
// every reader the job already calls — getSettingSync, isPluginEnabledSync,
// getAdminEmailsSync, civicPlaceCode — answers for that hub without being
// passed one. Hubs run one after another, not in parallel: the jobs are
// long, call a paid model, and one hub's failure must not be interleaved with
// another's in the logs.
//
// SCOPE NOTE (Phase 4, 2026-09-24). Adopted by the two content-sync crons —
// news sync and meeting summaries — because their configuration is the
// per-hub data this phase moved out of the code. The digest crons still run
// unscoped until Phase 2 converts crons as a whole. And until Phase 2 puts
// hub_id on `processes`, what a job CREATES lands in the one shared table;
// only a hub that configures a plugin produces anything, which today is Floyd
// alone.

import type { Hub } from "../models/hub.js";
import { getHubBySlug, listActiveHubs } from "../db/hubs.js";
import { fetchHubSettings } from "../db/hubSettingsStore.js";
import { withHubScope } from "../config/hubContext.js";

export interface HubRunResult<T> {
  hub_id: string;
  result?: T;
  /** Set when the job threw. The other hubs still ran. */
  error?: string;
}

/**
 * Run `job` once for each active hub, or for the one named by `onlyHub`.
 *
 * A throw is caught per hub and reported in the result, so one hub's broken
 * source cannot stop the others' runs. An `onlyHub` that names no active hub
 * yields an empty list — the caller decides whether that is an error.
 */
export async function forEachActiveHub<T>(
  job: (hub: Hub) => Promise<T>,
  opts: { onlyHub?: string | null } = {},
): Promise<Array<HubRunResult<T>>> {
  const hubs = opts.onlyHub
    ? [await getHubBySlug(opts.onlyHub)].filter(
        (h): h is Hub => h !== null && h.status === "active",
      )
    : await listActiveHubs();

  const out: Array<HubRunResult<T>> = [];
  for (const hub of hubs) {
    try {
      const settings = await fetchHubSettings(hub.id);
      const result = await withHubScope(hub, settings, () => job(hub));
      out.push({ hub_id: hub.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron] hub=${hub.id} job threw: ${message}`);
      out.push({ hub_id: hub.id, error: message });
    }
  }
  return out;
}

/**
 * The `?hub=` a manual trigger may pass to run one hub, or null. Only a
 * well-formed slug is honoured; anything else runs nothing rather than
 * everything.
 */
export function requestedHub(query: unknown): string | null | undefined {
  const raw = (query as { hub?: unknown } | undefined)?.hub;
  if (raw === undefined) return null;
  if (typeof raw !== "string" || !/^[a-z0-9-]{2,32}$/.test(raw)) return undefined;
  return raw;
}
