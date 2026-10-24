// The `hub-exports` bucket (20260926020000): where the console's "Export this
// hub" leaves an archive for the operator to download through a short-lived
// signed URL, and where the hourly sweep deletes it again after 24 hours.
// Both sides live here so the retention rule is written once. The hub app
// only ever sweeps; writing and signing are the super admin's (src/control/).
// Through the `objectStore` adapter (ADR-012): the bucket is private, and the
// Supabase store reaches it as the service role only.

import { adapters } from "../adapters/index.js";

export const HUB_EXPORTS_BUCKET = "hub-exports";
/** How long an export object is kept (the planning session, 2026-09-26). */
export const HUB_EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** How long the operator's download link works. */
export const HUB_EXPORT_LINK_SECONDS = 10 * 60;


/** Store an archive under `<hub>/<file>`; returns the object key. */
export async function storeHubExport(hubId: string, fileName: string, bytes: Buffer): Promise<string> {
  const key = `${hubId}/${fileName}`;
  try {
    await adapters().objectStore.put(HUB_EXPORTS_BUCKET, key, bytes, { contentType: "application/gzip" });
  } catch (err) {
    throw new Error(
      `Could not store the export (bucket ${HUB_EXPORTS_BUCKET}): ${(err as Error).message}. ` +
        "Is migration 20260926020000_hub_exports_bucket.sql applied?",
    );
  }
  return key;
}

/** A download link for `key`, valid HUB_EXPORT_LINK_SECONDS, saved as `fileName`. */
export async function signHubExport(key: string, fileName: string): Promise<{ url: string; expires_at: string }> {
  const url = await adapters().objectStore.signedUrl(HUB_EXPORTS_BUCKET, key, HUB_EXPORT_LINK_SECONDS, fileName);
  return { url, expires_at: new Date(Date.now() + HUB_EXPORT_LINK_SECONDS * 1000).toISOString() };
}

export interface SweepResult {
  deleted: string[];
  kept: number;
}

/**
 * Delete every export object written more than 24 hours before `now`. A
 * missing bucket (a plain Postgres install, or the migration not applied yet)
 * is nothing to sweep, not a failure.
 */
export async function sweepHubExports(now: Date): Promise<SweepResult> {
  const cutoff = now.getTime() - HUB_EXPORT_RETENTION_MS;
  const objects = await adapters().objectStore.listAll(HUB_EXPORTS_BUCKET);
  if (!objects) return { deleted: [], kept: 0 };
  const expired: string[] = [];
  let kept = 0;
  // Only objects inside a hub's folder, as before (`<hub>/<file>`).
  for (const obj of objects.filter((o) => o.key.includes("/"))) {
    const written = Date.parse(obj.createdAt ?? "");
    if (Number.isFinite(written) && written < cutoff) expired.push(obj.key);
    else kept++;
  }
  if (expired.length) await adapters().objectStore.remove(HUB_EXPORTS_BUCKET, expired);
  return { deleted: expired, kept };
}
