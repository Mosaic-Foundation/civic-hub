// @civic-raw-client-importer: the hub-exports bucket is private with no policies; only the service role reaches it.
//
// The `hub-exports` bucket (20260926020000): where the console's "Export this
// hub" leaves an archive for the operator to download through a short-lived
// signed URL, and where the hourly sweep deletes it again after 24 hours.
// Both sides live here so the retention rule is written once. The hub app
// only ever sweeps; writing and signing are the super admin's (src/control/).

import { getDb } from "./client.js";

export const HUB_EXPORTS_BUCKET = "hub-exports";
/** How long an export object is kept (the planning session, 2026-09-26). */
export const HUB_EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** How long the operator's download link works. */
export const HUB_EXPORT_LINK_SECONDS = 10 * 60;

const bucket = () => getDb().storage.from(HUB_EXPORTS_BUCKET);

/** Store an archive under `<hub>/<file>`; returns the object key. */
export async function storeHubExport(hubId: string, fileName: string, bytes: Buffer): Promise<string> {
  const key = `${hubId}/${fileName}`;
  const { error } = await bucket().upload(key, bytes, { contentType: "application/gzip", upsert: false });
  if (error) {
    throw new Error(
      `Could not store the export (bucket ${HUB_EXPORTS_BUCKET}): ${error.message}. ` +
        "Is migration 20260926020000_hub_exports_bucket.sql applied?",
    );
  }
  return key;
}

/** A download link for `key`, valid HUB_EXPORT_LINK_SECONDS, saved as `fileName`. */
export async function signHubExport(key: string, fileName: string): Promise<{ url: string; expires_at: string }> {
  const { data, error } = await bucket().createSignedUrl(key, HUB_EXPORT_LINK_SECONDS, { download: fileName });
  if (error || !data?.signedUrl) throw new Error(`Could not sign the export link: ${error?.message ?? "no URL"}`);
  return { url: data.signedUrl, expires_at: new Date(Date.now() + HUB_EXPORT_LINK_SECONDS * 1000).toISOString() };
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
  const top = await bucket().list("", { limit: 1000 });
  if (top.error) {
    if (/not.?found|bucket/i.test(top.error.message)) return { deleted: [], kept: 0 };
    throw new Error(`hub-exports sweep: ${top.error.message}`);
  }
  const expired: string[] = [];
  let kept = 0;
  for (const folder of (top.data ?? []).filter((e) => e.id === null)) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket().list(folder.name, { limit: 1000, offset });
      if (error) throw new Error(`hub-exports sweep: ${error.message}`);
      for (const obj of data ?? []) {
        if (obj.id === null) continue;
        const written = Date.parse(obj.created_at ?? "");
        if (Number.isFinite(written) && written < cutoff) expired.push(`${folder.name}/${obj.name}`);
        else kept++;
      }
      if (!data || data.length < 1000) break;
    }
  }
  if (expired.length) {
    const { error } = await bucket().remove(expired);
    if (error) throw new Error(`hub-exports sweep: ${error.message}`);
  }
  return { deleted: expired, kept };
}
