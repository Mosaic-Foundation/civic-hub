// The `heartbeat` adapter's fake (ADR-012): keeps every ping in memory.

import type { HeartbeatSink } from "../heartbeat.js";

export function fakeHeartbeat(): HeartbeatSink & { pings: Array<{ jobId: string; ok: boolean }> } {
  const pings: Array<{ jobId: string; ok: boolean }> = [];
  return {
    name: "fake",
    pings,
    async ping(jobId, ok) {
      pings.push({ jobId, ok });
    },
  };
}
