// Slice 9 — server-side helper for uploading post images to Supabase
// Storage. Pure storage concern, kept out of the controller so future
// callers (cron jobs, federation imports) don't have to re-implement
// the bucket / key naming.
//
// The upload itself is src/db/storage.ts. Who may upload is the route
// layer's call (`requireAnnouncementPoster`, `requireAdmin`); WHERE a hub may
// write is the bucket's: under the hub token the `post_images_hub_*` policies
// refuse any key outside `<hub_id>/`. With the token off the upload runs as
// the service role and the prefix below is the only scoping.
//
// Every new object lives under its hub (Phase 2b): `<hub_id>/YYYY/MM/…` for
// post images and `<hub_id>/identity/YYYY/MM/…` for a hub's banner and logo,
// so everything a hub owns in the bucket is one prefix to list, export or
// remove. Objects uploaded before (`YYYY/MM/…`, `hubs/<hub_id>/…`) keep their
// keys; their URLs are stored whole and stay valid.

import { uploadPublicObject } from "../db/storage.js";

const BUCKET_ENV = "SUPABASE_STORAGE_BUCKET";
const DEFAULT_BUCKET = "post-images";

export const POST_IMAGE_MIME_WHITELIST: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Vercel refuses a function request body over 4.5 MB with a bare 413 before
 * the app runs. Keeping the app's limit under it, with room for the multipart
 * wrapper, means an oversized image always gets the app's own message.
 */
export const UPLOAD_CEILING_MB = 4;

/** 4 MB default; IMAGE_UPLOAD_MAX_MB can lower it, never raise it past UPLOAD_CEILING_MB. */
export function imageUploadMaxBytes(): number {
  const raw = process.env.IMAGE_UPLOAD_MAX_MB;
  const mb = raw ? Number(raw) : UPLOAD_CEILING_MB;
  const valid = Number.isFinite(mb) && mb > 0 ? mb : UPLOAD_CEILING_MB;
  return Math.floor(Math.min(valid, UPLOAD_CEILING_MB) * 1024 * 1024);
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

/**
 * Where a hub's objects live in the bucket: `<hub_id>`, or
 * `<hub_id>/<folder>` for a kind kept apart (`identity` for the banner and
 * logo).
 */
export function hubImagePrefix(hubId: string, folder?: "identity"): string {
  if (!/^[a-z0-9-]{2,32}$/.test(hubId)) {
    throw new Error(`Not a hub id: "${hubId}"`);
  }
  return folder ? `${hubId}/${folder}` : hubId;
}

/**
 * Upload bytes to the post-images bucket. Returns the publicly-resolvable
 * URL. Throws on Supabase errors; callers translate to HTTP 500.
 */
export async function uploadPostImage(
  hubId: string,
  bytes: Buffer,
  mime: string,
  prefix: string,
): Promise<{ key: string; url: string }> {
  const key = makeImageKey(mime, new Date(), prefix);
  const url = await uploadPublicObject(hubId, postImageBucket(), key, bytes, {
    contentType: mime,
    cacheControl: "31536000, immutable",
  });
  return { key, url };
}
