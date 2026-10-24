// The `objectStore` adapter (ADR-012): files kept outside the database (post
// images, which are public, and the console's hub exports, which are not).
// Every key a hub writes starts with `<hub_id>/`. Hosting:
// src/hosting/supabaseStorage.ts. Fake: src/adapters/fakes/objectStore.ts.

export interface StoredObject {
  key: string;
  /** When it was written, ISO, if the store says. */
  createdAt: string | null;
}

export interface ObjectStore {
  readonly name: string;
  /** Store a public object for a hub and return its public URL. Refuses a key outside the hub's prefix where the store enforces it. */
  putPublic(hubId: string, bucket: string, key: string, bytes: Buffer, opts: { contentType: string; cacheControl: string }): Promise<string>;
  /** Store a private object (no overwrite). */
  put(bucket: string, key: string, bytes: Buffer, opts: { contentType: string }): Promise<void>;
  /** A short-lived download link. */
  signedUrl(bucket: string, key: string, seconds: number, downloadName?: string): Promise<string>;
  /** Every object in the bucket, recursively; null when the bucket does not exist. */
  listAll(bucket: string): Promise<StoredObject[] | null>;
  remove(bucket: string, keys: string[]): Promise<void>;
}
