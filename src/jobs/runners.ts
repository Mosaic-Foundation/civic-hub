// What each job in src/jobs/registry.ts does for one hub. Keyed on the same
// ids; tests/unit/jobRegistry.test.ts fails if a job has no runner or a
// runner has no job. Each runner is called inside the hub's scope, so every
// settings read, forHub() call and mail guard answers for that hub.

import type { JobRunner } from "./types.js";
import { runDigestForHub } from "../controllers/digestController.js";
import { runAdminDigestForHub } from "../controllers/adminDigestController.js";
import { runNewsSyncForHub } from "../controllers/newsSyncController.js";
import { RunSink, runMeetingSummaryForHub } from "../controllers/meetingSummaryController.js";

export const JOB_RUNNERS: Readonly<Record<string, JobRunner>> = {
  meeting_summary: async () => {
    const sink = new RunSink();
    await runMeetingSummaryForHub(sink);
    return sink.result ?? { status: 500, body: { error: "run wrote no outcome" } };
  },
  news_sync: () => runNewsSyncForHub(),
  digest: (input) => runDigestForHub(input),
  admin_digest: () => runAdminDigestForHub(),
};
