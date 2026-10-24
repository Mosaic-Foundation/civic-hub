// The `heartbeat` adapter's Healthchecks.io implementation (hosting layer,
// ADR-012; operations shell, ADR-006): each scheduled job tells
// Healthchecks.io it finished. The engine calls adapters().heartbeat.ping(). Healthchecks.io alerts when a ping is late,
// which is the one failure the job can't report itself: not running at all.
//
// One ping key for the project, one check per job, addressed by slug:
// `https://hc-ping.com/<key>/<slug>`, `/fail` appended when the run failed
// (an immediate alert). The checks, with their schedules and grace periods,
// are made from the job registry by `npm run heartbeats:sync`.
//
// Off unless CIVIC_HEARTBEAT_PING_KEY is set (production only). A ping that
// fails or hangs never fails the job: bounded by a timeout, errors swallowed.

import { hostingEnv } from "../config/env.js";
import type { HeartbeatSink } from "../adapters/heartbeat.js";

export const HEARTBEAT_BASE = "https://hc-ping.com";
const PING_TIMEOUT_MS = 5000;

/** The check's slug for a job id: `vote_close` → `vote-close`. */
export function heartbeatSlug(jobId: string): string {
  return jobId.replace(/_/g, "-");
}

/** Where a job's ping goes, or null when heartbeats are off. */
export function heartbeatUrl(jobId: string, ok: boolean, key = hostingEnv.CIVIC_HEARTBEAT_PING_KEY): string | null {
  if (!key) return null;
  return `${HEARTBEAT_BASE}/${encodeURIComponent(key)}/${heartbeatSlug(jobId)}${ok ? "" : "/fail"}`;
}

/** Ping the job's heartbeat. Resolves when sent, or on any failure. */
export async function pingHeartbeat(jobId: string, ok: boolean, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = heartbeatUrl(jobId, ok);
  if (!url) return;
  try {
    const res = await fetchImpl(url, { method: "POST", signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    // The key is in the URL: name the job, never the URL.
    console.warn(`[heartbeat] ${jobId}: ping failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The `heartbeat` adapter: Healthchecks.io pings, off without a key. */
export const healthchecksHeartbeat: HeartbeatSink = {
  name: "healthchecks",
  ping: (jobId, ok) => pingHeartbeat(jobId, ok),
};
