// @civic-raw-client-importer: object storage is a service-role operation with no hub_id column to scope.
//
// Object storage — the one raw-client operation outside tables. Buckets have
// no hub_id, so forHub() cannot scope them; the caller scopes by key instead
// (src/services/postImageStorage.ts puts every new object under `<hub_id>/`).
// Kept here so nothing outside src/db/ holds the service-role client.

import { getDb } from "./client.js";

/** Upload one object and return its public URL. Throws on any storage error. */
export async function uploadPublicObject(
  bucket: string,
  key: string,
  bytes: Buffer,
  options: { contentType: string; cacheControl: string },
): Promise<string> {
  const storage = getDb().storage.from(bucket);
  const upload = await storage.upload(key, bytes, {
    contentType: options.contentType,
    upsert: false,
    cacheControl: options.cacheControl,
  });
  if (upload.error) {
    throw new Error(`Storage upload failed (bucket=${bucket}): ${upload.error.message}`);
  }
  const { data } = storage.getPublicUrl(key);
  if (!data?.publicUrl) {
    throw new Error("Storage returned an empty public URL");
  }
  return data.publicUrl;
}
