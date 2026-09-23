// Admin digest controller — Slice 16.
//
// POST /internal/admin-digest/run
//   Cron-triggered. CRON_SECRET bearer auth (Vercel Cron auto-injects).
//   Counts pending items in each admin-review queue and emails every
//   admin in the people.admin_emails hub setting (falls back to
//   CIVIC_ADMIN_EMAILS). Empty digests are skipped silently.

// TODO(phase2): this runs from a cron with no hub in scope, so the reads
// below resolve from env rather than per hub. Phase 2 makes crons iterate
// hubs and run once per hub.

import type { Request, Response } from "express";
import { runAdminDigest } from "../modules/civic.admin_digest/index.js";
import { getAdminEmailsSync } from "../services/hubSettings.js";

function requireCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  return token.length > 0 && token === secret;
}

function adminDigestEnabled(): boolean {
  // Default true. Only "false" (case-insensitive) disables. Lets ops
  // pause admin notifications without un-deploying.
  const v = process.env.ADMIN_DIGEST_ENABLED?.trim().toLowerCase();
  return v !== "false";
}

function adminRecipients(): string[] {
  return getAdminEmailsSync();
}

export async function handleRunAdminDigest(
  req: Request,
  res: Response,
): Promise<void> {
  if (!requireCronSecret(req)) {
    res.status(401).json({ error: "Invalid or missing cron credential" });
    return;
  }

  if (!adminDigestEnabled()) {
    res.status(200).json({ skipped: true, reason: "admin digest disabled" });
    return;
  }

  const recipients = adminRecipients();
  const started = Date.now();

  try {
    const result = await runAdminDigest(recipients);
    const elapsedMs = Date.now() - started;
    console.log(
      `[admin-digest] done in ${elapsedMs}ms: total=${result.total} sent=${result.sent} skipped=${result.skipped} failed=${result.failed} empty=${result.empty}`,
    );
    res.json({ ...result, elapsed_ms: elapsedMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[admin-digest] run failed: ${message}`);
    res.status(500).json({ error: message });
  }
}
