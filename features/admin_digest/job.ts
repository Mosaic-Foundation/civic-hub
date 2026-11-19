// The "admin_digest" job (the plugin's manifest): the daily email that tells a
// space's admins what is new in their queues.
//
// Runs once a day per active space, inside that space's scope: counts what is
// new in each admin queue since the last digest that went out, with what is
// waiting beside it, and emails the space's admins (people.admin_emails,
// CIVIC_ADMIN_EMAILS as the bootstrap for a hub with no row). Nothing new:
// nothing sent (./digest.ts). The job runner has already checked the cron
// credential and plugin.admin_digest.enabled (whose env fallback is
// ADMIN_DIGEST_ENABLED). Returns a JobOutcome: 200 with the send counts, 500
// with an error if the run throws.

import { currentHubId, offices, type JobOutcome, type JobRunner } from "../../src/sdk/index.js";
import { runAdminDigest } from "./digest.js";
import type { MarkStore } from "./store.js";

export function adminDigestJob(marks: MarkStore): JobRunner {
  return async (): Promise<JobOutcome> => {
    const recipients = offices.adminEmails();
    const started = Date.now();
    try {
      const result = await runAdminDigest(marks, recipients);
      const elapsedMs = Date.now() - started;
      console.log(
        `[admin-digest] hub=${currentHubId()} done in ${elapsedMs}ms: total=${result.total} sent=${result.sent} skipped=${result.skipped} failed=${result.failed} empty=${result.empty}`,
      );
      return { status: 200, body: { ...result, elapsed_ms: elapsedMs } };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[admin-digest] hub=${currentHubId()} run failed: ${message}`);
      return { status: 500, body: { error: message } };
    }
  };
}
