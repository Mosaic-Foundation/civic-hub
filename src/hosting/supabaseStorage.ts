// @civic-raw-client-importer: object storage has no hub_id column; it is scoped by key, and by policy under the hub token.
//
// The `objectStore` adapter's Supabase Storage implementation (hosting
// layer, ADR-012), and the console's object reader for a hub export.
//
// Buckets have no hub_id column, so forHub() cannot scope them; every object
// lives under its hub's key prefix instead (src/services/postImageStorage.ts:
// `<hub_id>/…`). Under the hub token (CIVIC_HUB_MINTED_TOKEN on) a public
// upload runs as `authenticated` with the hub's `hub_id` claim, and the four
// `post_images_hub_*` policies on storage.objects (20260924070000) are what
// enforce the prefix: an upload for Athens under `floyd/…` is refused by
// Storage, whatever the code asked for. With the flag off it runs as the
// service role, as it always has. Public reads never pass through here: the
// bucket is public, so an object's URL resolves without any token. Private
// buckets (hub-exports) are the service role's only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { UnavailableError } from "../errors/index.js";
import { getDb, getHubTokenDb, hubTokensEnabled } from "../db/client.js";
import type { ObjectStore, StoredObject } from "../adapters/objectStore.js";

/** The console's export reader shape (src/control/hubBundle/export.ts, ObjectReader). */
export interface StorageObjectReader {
  storageBaseUrl: string;
  bucket: string;
  listKeys(prefix: string): Promise<string[]>;
  listTop(): Promise<string[]>;
  download(key: string): Promise<{ bytes: Buffer; contentType: string }>;
}

const PAGE = 1000;
const HUB_ID_SHAPE = /^[a-z0-9-]{2,32}$/;
const tokenClients = new Map<string, SupabaseClient>();

/** The client a public upload for `hubId` goes through right now; the flag is read per call. */
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

/** Every object under `path`, recursively; null when the bucket does not exist. */
async function listRecursive(bucket: string, path: string, into: StoredObject[]): Promise<boolean> {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await getDb().storage.from(bucket).list(path, { limit: PAGE, offset });
    if (error) {
      if (path === "" && /not.?found|bucket/i.test(error.message)) return false;
      throw new Error(`storage: listing ${bucket}/${path}: ${error.message}`);
    }
    for (const e of data ?? []) {
      const full = path ? `${path}/${e.name}` : e.name;
      // Storage marks a folder by a null id.
      if (e.id === null) await listRecursive(bucket, full, into);
      else into.push({ key: full, createdAt: e.created_at ?? null });
    }
    if (!data || data.length < PAGE) return true;
  }
}

export const supabaseStorage: ObjectStore = {
  name: "supabase",
  async putPublic(hubId, bucket, key, bytes, opts) {
    const storage = storageClientFor(hubId).storage.from(bucket);
    const upload = await storage.upload(key, bytes, {
      contentType: opts.contentType,
      upsert: false,
      cacheControl: opts.cacheControl,
    });
    if (upload.error) {
      throw new UnavailableError(
        "The image couldn't be stored right now. Please try again in a moment.",
        "storage_unavailable",
        { cause: new Error(`Storage upload failed (bucket=${bucket}): ${upload.error.message}`) },
      );
    }
    const { data } = storage.getPublicUrl(key);
    if (!data?.publicUrl) {
      throw new Error("Storage returned an empty public URL");
    }
    return data.publicUrl;
  },
  async put(bucket, key, bytes, opts) {
    const { error } = await getDb().storage.from(bucket).upload(key, bytes, { contentType: opts.contentType, upsert: false });
    if (error) throw new Error(`storage: storing ${bucket}/${key}: ${error.message}`);
  },
  async signedUrl(bucket, key, seconds, downloadName) {
    const { data, error } = await getDb()
      .storage.from(bucket)
      .createSignedUrl(key, seconds, downloadName ? { download: downloadName } : undefined);
    if (error || !data?.signedUrl) throw new Error(`storage: signing ${bucket}/${key}: ${error?.message ?? "no URL"}`);
    return data.signedUrl;
  },
  async listAll(bucket) {
    const out: StoredObject[] = [];
    return (await listRecursive(bucket, "", out)) ? out : null;
  },
  async remove(bucket, keys) {
    if (keys.length === 0) return;
    const { error } = await getDb().storage.from(bucket).remove(keys);
    if (error) throw new Error(`storage: removing from ${bucket}: ${error.message}`);
  },
};

/** The console's reader over this deployment's own storage, for a hub export (src/control/hubBundle/). */
export function supabaseObjectReader(bucket: string): StorageObjectReader {
  const base = env.SUPABASE_URL;
  if (!base) throw new Error("export: SUPABASE_URL is not set");
  const store = () => getDb().storage.from(bucket);

  async function listLevel(path: string): Promise<Array<{ name: string; isFolder: boolean }>> {
    const out: Array<{ name: string; isFolder: boolean }> = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await store().list(path, {
        limit: PAGE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`export: listing ${bucket}/${path} failed: ${error.message}`);
      // Storage marks a folder by a null id; the placeholder a folder keeps
      // once emptied is not an object.
      for (const e of data ?? []) {
        if (e.name === ".emptyFolderPlaceholder") continue;
        out.push({ name: e.name, isFolder: e.id === null });
      }
      if (!data || data.length < PAGE) return out;
    }
  }

  async function walk(path: string, into: string[]): Promise<void> {
    for (const e of await listLevel(path)) {
      const full = path ? `${path}/${e.name}` : e.name;
      if (e.isFolder) await walk(full, into);
      else into.push(full);
    }
  }

  return {
    storageBaseUrl: base,
    bucket,
    async listKeys(prefix) {
      const keys: string[] = [];
      await walk(prefix.replace(/\/+$/, ""), keys);
      return keys;
    },
    async listTop() {
      return (await listLevel("")).map((e) => e.name);
    },
    async download(key) {
      const { data, error } = await store().download(key);
      if (error || !data) throw new Error(`export: downloading ${bucket}/${key} failed: ${error?.message ?? "no data"}`);
      return {
        bytes: Buffer.from(await data.arrayBuffer()),
        contentType: data.type || "application/octet-stream",
      };
    },
  };
}
