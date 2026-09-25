// @civic-raw-client-importer: object storage has no hub_id column; it is scoped by key, and by policy under the hub token.
//
// Object storage — the one database operation outside tables. Buckets have no
// hub_id column, so forHub() cannot scope them; every object lives under its
// hub's key prefix instead (src/services/postImageStorage.ts: `<hub_id>/…`).
//
// Under the hub token (CIVIC_HUB_MINTED_TOKEN on) an upload runs as
// `authenticated` with the hub's `hub_id` claim, and the four
// `post_images_hub_*` policies on storage.objects (20260924070000) are what
// enforce the prefix: an upload for Athens under `floyd/…` is refused by
// Storage, whatever the code asked for. With the flag off it runs as the
// service role, as it always has. Public reads never pass through here: the
// bucket is public, so an object's URL resolves without any token.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, getHubTokenDb, hubTokensEnabled } from "./client.js";

const HUB_ID_SHAPE = /^[a-z0-9-]{2,32}$/;
const tokenClients = new Map<string, SupabaseClient>();

/** The client an upload for `hubId` goes through right now; the flag is read per call. */
function storageClientFor(hubId: string): SupabaseClient {
  if (!hubTokensEnabled()) return getDb();
  if (!HUB_ID_SHAPE.test(hubId)) throw new Error(`storage: "${hubId}" is not a hub id.`);
  let client = tokenClients.get(hubId);
  if (!client) {
    client = getHubTokenDb(hubId);
    tokenClients.set(hubId, client);
  }
  return client;
}

/**
 * Upload one object for a hub and return its public URL. Throws on any
 * storage error — including a policy refusal under the hub token, which is
 * what a key outside `<hubId>/` gets.
 */
export async function uploadPublicObject(
  hubId: string,
  bucket: string,
  key: string,
  bytes: Buffer,
  options: { contentType: string; cacheControl: string },
): Promise<string> {
  const storage = storageClientFor(hubId).storage.from(bucket);
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
