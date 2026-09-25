// Run one job across hubs: every active hub, or the one a manual run names.
//
// Each hub runs inside its own scope (forEachActiveHub), is skipped when its
// `plugin.<id>.enabled` is off, and is isolated: a throw becomes that hub's
// error and the next hub still runs. The result names every hub it looked at,
// so a log line says which hubs ran, which skipped and why.

import type { JobSpec } from "./registry.js";
import type { JobOutcome, JobRunInput, JobRunner } from "./types.js";
import { forEachActiveHub } from "../services/cronHubs.js";
import { isPluginEnabledSync } from "../services/hubSettings.js";

export interface JobRunReport {
  /** The worst hub's status: 500 if any hub failed, else the highest. */
  status: number;
  hubs: Record<string, Record<string, unknown>>;
}

export async function runJobAcrossHubs(
  job: JobSpec,
  runner: JobRunner,
  input: JobRunInput & { onlyHub: string | null },
): Promise<JobRunReport | { status: 404; error: string }> {
  const runs = await forEachActiveHub<JobOutcome>(
    async () => {
      if (!isPluginEnabledSync(job.plugin)) {
        return {
          status: 200,
          body: { skipped: true, reason: `plugin.${job.plugin}.enabled is off` },
        };
      }
      return runner({ now: input.now, force: input.force });
    },
    { onlyHub: input.onlyHub },
  );

  if (input.onlyHub && runs.length === 0) {
    return { status: 404, error: `no active hub "${input.onlyHub}"` };
  }

  const hubs: JobRunReport["hubs"] = {};
  let status = 200;
  for (const run of runs) {
    if (run.error !== undefined) {
      hubs[run.hub_id] = { error: run.error };
      status = 500;
    } else if (run.result) {
      hubs[run.hub_id] = run.result.body;
      status = Math.max(status, run.result.status);
    }
  }
  return { status, hubs };
}
