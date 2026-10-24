// What each job in src/jobs/registry.ts does for one hub. Keyed on the same
// ids; tests/unit/jobRegistry.test.ts fails if a job has no runner or a
// runner has no job. Each runner is called inside the hub's scope, so every
// settings read, forHub() call and mail guard answers for that hub.

import type { JobOutcome, JobRunInput, JobRunner } from "./types.js";
import { digestJob } from "./digest.js";
import { adminDigestJob } from "./adminDigest.js";
import { newsSyncJob } from "./newsSync.js";
import { meetingSummaryJob } from "./meetingSummary.js";
import { sweepHubExports } from "../services/hubExportsStore.js";
import { closeAllExpired } from "../services/processService.js";
import { isPluginEnabledSync } from "../services/hubSettings.js";
import { refreshSamples } from "../services/sampleRefresh.js";
import { clearEndedArchivedVoteKeys, reshuffleOpenBallots } from "../modules/civic.receipts/index.js";

export const JOB_RUNNERS: Readonly<Record<string, JobRunner>> = {
  meeting_summary: meetingSummaryJob,
  news_sync: newsSyncJob,
  digest: digestJob,
  admin_digest: adminDigestJob,
  vote_close: async ({ now }) => {
    // Every type with a deadline whose plugin is on (2026-10-13), not only votes.
    const r = await closeAllExpired();
    // Then rewrite the ballots of every open vote in random order (ballot
    // secrecy, 2026-10-10): this runs at :05, about 12 minutes before each
    // 6-hourly backup, so a backup lines no ballot up with its voter by row
    // order except those cast in the minutes between. Only where Votes is on.
    let reshuffled: { processes: number; ballots: number } | null = null;
    let reshuffleError: string | null = null;
    if (isPluginEnabledSync("vote")) {
      try {
        reshuffled = await reshuffleOpenBallots(now);
      } catch (err) {
        reshuffleError = (err as Error).message;
      }
    }
    // Archived votes past their window get the close's last step (bridge rows
    // cleared, ballots shuffled) and stay archived (2026-10-14). Whatever the
    // plugin switch says: these rows link voters to receipts.
    let archivedFinished: string[] = [];
    let archivedError: string | null = null;
    try {
      archivedFinished = await clearEndedArchivedVoteKeys(now);
    } catch (err) {
      archivedError = (err as Error).message;
    }
    const failed = r.failed.length > 0 || reshuffleError !== null || archivedError !== null;
    return {
      status: failed ? 500 : 200,
      body: { ...r, reshuffled, reshuffle_error: reshuffleError, archived_finished: archivedFinished, archived_error: archivedError },
    };
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
