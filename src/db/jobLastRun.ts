// @civic-raw-client-importer: job_last_run is platform data: one scheduled run covers every hub, so no hub owns the row.
// The last scheduled run of each job, whatever it did (20261019000000).
//
// job_runs (src/services/jobRuns.ts) keeps a hub's run only when it did
// something, so it cannot tell a job that ran quietly from one that never
// ran. This keeps one row per job, replaced at the end of every scheduled run
// (src/routes/jobRoutes.ts, beside the heartbeat), for the console's
// Dashboard to mark a late job.
//
// Best-effort, like the run log: a row that cannot be written must never turn
// a good run into a failed one.

import { getDb } from "./client.js";

export interface JobLastRun {
  job_id: string;
  started_at: string;
  finished_at: string;
  status: "ok" | "failed";
  duration_ms: number;
  hubs_run: number;
  hubs_failed: number;
  error: string | null;
}

const COLUMNS = "job_id, started_at, finished_at, status, duration_ms, hubs_run, hubs_failed, error";

export async function recordJobLastRun(
  jobId: string,
  startedAt: Date,
  outcome: { ok: boolean; hubsRun: number; hubsFailed: number; error?: string | null },
): Promise<void> {
  const finished = new Date();
  try {
    const { error } = await getDb()
      .from("job_last_run")
      .upsert(
        {
          job_id: jobId,
          started_at: startedAt.toISOString(),
          finished_at: finished.toISOString(),
          status: outcome.ok ? "ok" : "failed",
          duration_ms: Math.max(0, finished.getTime() - startedAt.getTime()),
          hubs_run: outcome.hubsRun,
          hubs_failed: outcome.hubsFailed,
          error: outcome.error ? outcome.error.slice(0, 300) : null,
        },
        { onConflict: "job_id" },
      );
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(`[job-last-run] could not record ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Every job's last scheduled run, keyed by job id. */
export async function readJobLastRuns(): Promise<Record<string, JobLastRun>> {
  const { data, error } = await getDb().from("job_last_run").select(COLUMNS);
  if (error) throw new Error(`job_last_run read failed: ${error.message}`);
  return Object.fromEntries(((data ?? []) as JobLastRun[]).map((r) => [r.job_id, r]));
}
