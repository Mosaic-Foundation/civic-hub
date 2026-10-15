// Admin digest — the "admin_digest" job (src/jobs/registry.ts).
//
// Runs once a day per active hub, inside that hub's scope: counts what is new
// in each of that hub's admin queues since the last digest that went out, with
// what is waiting beside it, and emails that hub's admins (people.admin_emails,
// CIVIC_ADMIN_EMAILS as the bootstrap for a hub with no row). Nothing new:
// nothing sent (src/modules/civic.admin_digest/service.ts). The job runner has
// already checked the cron credential and plugin.admin_digest.enabled (whose
// env fallback is ADMIN_DIGEST_ENABLED).
//
// Slice 16; per hub since Phase 2c.

import { runAdminDigest } from "../modules/civic.admin_digest/index.js";
import { getAdminEmailsSync } from "../services/hubSettings.js";
import { currentHubId } from "../config/hubContext.js";
import type { JobOutcome } from "../jobs/types.js";

export async function runAdminDigestForHub(): Promise<JobOutcome> {
  const recipients = getAdminEmailsSync();
  const started = Date.now();
  try {
    const result = await runAdminDigest(recipients);
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
}
