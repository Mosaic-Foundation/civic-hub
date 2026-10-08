// What each job in src/jobs/registry.ts does for one hub. Keyed on the same
// ids; tests/unit/jobRegistry.test.ts fails if a job has no runner or a
// runner has no job. Each runner is called inside the hub's scope, so every
// settings read, forHub() call and mail guard answers for that hub.

import type { JobOutcome, JobRunInput, JobRunner } from "./types.js";
import { runDigestForHub } from "../controllers/digestController.js";
import { runAdminDigestForHub } from "../controllers/adminDigestController.js";
import { runNewsSyncForHub } from "../controllers/newsSyncController.js";
import { RunSink, runMeetingSummaryForHub } from "../controllers/meetingSummaryController.js";
import { sweepHubExports } from "../db/hubExportsBucket.js";
import { closeExpiredProcesses } from "../services/processService.js";
import { refreshSamples } from "../services/sampleRefresh.js";

export const JOB_RUNNERS: Readonly<Record<string, JobRunner>> = {
  meeting_summary: async () => {
    const sink = new RunSink();
    await runMeetingSummaryForHub(sink);
    return sink.result ?? { status: 500, body: { error: "run wrote no outcome" } };
  },
  news_sync: () => runNewsSyncForHub(),
  digest: (input) => runDigestForHub(input),
  admin_digest: () => runAdminDigestForHub(),
  vote_close: async () => {
    const r = await closeExpiredProcesses("civic.vote");
    return { status: r.failed.length ? 500 : 200, body: r };
  },
  sample_refresh: async ({ now }) => {
    const r = await refreshSamples({ now });
    return { status: 200, body: r as unknown as Record<string, unknown> };
  },
};

/**
 * Platform jobs (`scope: "platform"` in the registry): run once per call,
 * outside any hub's scope.
 */
export const PLATFORM_JOB_RUNNERS: Readonly<Record<string, (input: JobRunInput) => Promise<JobOutcome>>> = {
  hub_exports_sweep: async ({ now }) => {
    const { deleted, kept } = await sweepHubExports(now);
    return { status: 200, body: { deleted: deleted.length, kept, keys: deleted } };
  },
};
