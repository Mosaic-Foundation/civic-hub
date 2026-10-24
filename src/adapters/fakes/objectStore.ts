// The `objectStore` adapter's in-memory store (ADR-012): the run-anywhere CI
// job's store, and the unit suite's. Public URLs point at a host that does
// not resolve; nothing serves them. A self-hosted hub supplies a real store
// (S3-compatible, or a directory its web server serves) in src/hosting/.

import type { ObjectStore, StoredObject } from "../objectStore.js";

export const MEMORY_OBJECT_BASE = "https://objects.memory.invalid";

export function memoryObjectStore(): ObjectStore & { objects: Map<string, { bytes: Buffer; contentType: string; createdAt: string }> } {
  const objects = new Map<string, { bytes: Buffer; contentType: string; createdAt: string }>();
  const id = (bucket: string, key: string) => `${bucket}/${key}`;
  const put = (bucket: string, key: string, bytes: Buffer, contentType: string) => {
    if (objects.has(id(bucket, key))) throw new Error(`objectStore: ${bucket}/${key} already exists`);
    objects.set(id(bucket, key), { bytes, contentType, createdAt: new Date().toISOString() });
  };
  return {
    name: "memory",
    objects,
    async putPublic(hubId, bucket, key, bytes, opts) {
      if (!key.startsWith(`${hubId}/`)) throw new Error(`objectStore: ${key} is outside ${hubId}/`);
      put(bucket, key, bytes, opts.contentType);
      return `${MEMORY_OBJECT_BASE}/${bucket}/${key}`;
    },
    async put(bucket, key, bytes, opts) {
      put(bucket, key, bytes, opts.contentType);
    },
    async signedUrl(bucket, key, seconds) {
      if (!objects.has(id(bucket, key))) throw new Error(`objectStore: no ${bucket}/${key}`);
      return `${MEMORY_OBJECT_BASE}/${bucket}/${key}?expires=${seconds}`;
    },
    async listAll(bucket): Promise<StoredObject[] | null> {
      const prefix = `${bucket}/`;
      return [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({ key: k.slice(prefix.length), createdAt: v.createdAt }));
    },
    async remove(bucket, keys) {
      for (const k of keys) objects.delete(id(bucket, k));
    },
  };
}
