// Slice 9 — server-side helper for uploading post images to Supabase
// Storage. Pure storage concern, kept out of the controller so future
// callers (cron jobs, federation imports) don't have to re-implement
// the bucket / key naming.
//
// The service-role Supabase client (db/client.ts) bypasses RLS, so we
// rely on the auth middleware (`requireAnnouncementPoster`) at the
// route layer to gate uploads. The bucket itself also has an RLS
// policy as defense-in-depth — see HANDOFF Slice 9 for the operator
// walkthrough that creates it.

import { getDb } from "../db/client.js";

const BUCKET_ENV = "SUPABASE_STORAGE_BUCKET";
const DEFAULT_BUCKET = "post-images";

export const POST_IMAGE_MIME_WHITELIST: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** 5 MB default; configurable via IMAGE_UPLOAD_MAX_MB. */
export function imageUploadMaxBytes(): number {
  const raw = process.env.IMAGE_UPLOAD_MAX_MB;
  const mb = raw ? Number(raw) : 5;
  if (!Number.isFinite(mb) || mb <= 0) return 5 * 1024 * 1024;
  return Math.floor(mb * 1024 * 1024);
}

export function postImageBucket(): string {
  return process.env[BUCKET_ENV] ?? DEFAULT_BUCKET;
}

/**
 * Map a MIME type to the file extension we'll store under. Defends
 * against MIME spoofing in the key only — the bytes are whatever the
 * client uploaded (validated separately via image-size).
 */
function extFor(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

/**
 * Generate a storage key of the form `YYYY/MM/<uuid>.<ext>`. The
 * year-month prefix keeps the bucket browsable in the Supabase dashboard
 * and is friendly to future per-month archive policies.
 *
 * With a `prefix`, the key is `<prefix>/YYYY/MM/<uuid>.<ext>`. A hub's own
 * images (its banner, its logo) go under `hubs/<hub id>/`, so everything a
 * hub owns in the bucket can be listed, exported or removed by prefix.
 */
export function makeImageKey(
  mime: string,
  now: Date = new Date(),
  prefix?: string,
): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const key = `${yyyy}/${mm}/${uuid}.${extFor(mime)}`;
  return prefix ? `${prefix}/${key}` : key;
}

/** Where a hub's own images live in the bucket. */
export function hubImagePrefix(hubId: string): string {
  if (!/^[a-z0-9-]{2,32}$/.test(hubId)) {
    throw new Error(`Not a hub id: "${hubId}"`);
  }
  return `hubs/${hubId}`;
}

/**
 * Upload bytes to the post-images bucket. Returns the publicly-resolvable
 * URL. Throws on Supabase errors; callers translate to HTTP 500.
 */
export async function uploadPostImage(
  bytes: Buffer,
  mime: string,
  prefix?: string,
): Promise<{ key: string; url: string }> {
  const bucket = postImageBucket();
  const key = makeImageKey(mime, new Date(), prefix);
  const db = getDb();

  const upload = await db.storage.from(bucket).upload(key, bytes, {
    contentType: mime,
    upsert: false,
    cacheControl: "31536000, immutable",
  });
  if (upload.error) {
    throw new Error(
      `Storage upload failed (bucket=${bucket}): ${upload.error.message}`,
    );
  }

  const { data } = db.storage.from(bucket).getPublicUrl(key);
  if (!data?.publicUrl) {
    throw new Error("Storage returned an empty public URL");
  }
  return { key, url: data.publicUrl };
}
