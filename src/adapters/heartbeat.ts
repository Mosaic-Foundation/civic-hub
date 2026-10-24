// The `heartbeat` adapter (ADR-012, ADR-006): a scheduled job's "I ran" to an
// outside watcher, which alerts when one is late or failed. Hosting:
// src/hosting/healthchecks.ts. Fake: src/adapters/fakes/heartbeat.ts.

export interface HeartbeatSink {
  readonly name: string;
  /** Resolves when sent, or on any failure; never fails the job. */
  ping(jobId: string, ok: boolean): Promise<void>;
}
