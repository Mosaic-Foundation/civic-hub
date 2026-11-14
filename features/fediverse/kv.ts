// Fedify's working memory in the hub's database (security audit 2026-11-14,
// M2): which incoming messages it has already handled, and the other servers'
// documents and keys it fetched. In one server instance's memory, as phase 1
// had it, every short-lived Vercel instance started empty, so a message
// delivered twice to two instances was handled twice.
//
// One row per key in fediverse_kv, for the hub in scope. A key is Fedify's
// array of strings, each part hex-encoded and joined by dots, so listing by
// prefix is a plain LIKE with no characters to escape. A value that is not
// plain JSON is not kept (Fedify then fetches again: slower, never wrong).

import type { KvKey, KvStore, KvStoreListEntry, KvStoreSetOptions } from "@fedify/fedify";
import type { FeatureHost } from "../../src/sdk/index.js";

const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
const unhex = (s: string) => Buffer.from(s, "hex").toString("utf8");

export function encodeKey(key: KvKey): string {
  return key.map(hex).join(".");
}

export function decodeKey(key: string): KvKey {
  return key.split(".").map(unhex) as unknown as KvKey;
}

function expiresAt(options?: KvStoreSetOptions): string | null {
  const ttl = options?.ttl;
  if (!ttl) return null;
  const ms = ttl.total({ unit: "milliseconds" });
  return new Date(Date.now() + ms).toISOString();
}

function asJson(value: unknown): unknown | undefined {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

interface Row {
  key: string;
  value: unknown;
  expires_at: string | null;
}

const live = (r: Row) => !r.expires_at || Date.parse(r.expires_at) > Date.now();

export function dbKv(host: FeatureHost): KvStore {
  const table = () => host.db().from("fediverse_kv");
  return {
    async get<T = unknown>(key: KvKey): Promise<T | undefined> {
      const row = await table().select<Row>("key, value, expires_at").eq("key", encodeKey(key)).maybeSingle();
      return row && live(row) ? (row.value as T) : undefined;
    },
    async set(key: KvKey, value: unknown, options?: KvStoreSetOptions): Promise<void> {
      const json = asJson(value);
      if (json === undefined) return;
      await table().upsert({ key: encodeKey(key), value: json, expires_at: expiresAt(options) }, { onConflict: "hub_id,key" });
    },
    async delete(key: KvKey): Promise<void> {
      await table().delete().eq("key", encodeKey(key));
    },
    async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
      let q = table().select<Row>("key, value, expires_at");
      if (prefix && prefix.length > 0) {
        const p = encodeKey(prefix);
        q = q.or(`key.eq.${p},key.like.${p}.*`);
      }
      const rows = await q.order("key", { ascending: true }).limit(1000);
      for (const r of rows) if (live(r)) yield { key: decodeKey(r.key), value: r.value };
    },
  };
}

/** Delete what has expired, for the hub in scope (the job's tidy-up). */
export async function sweepKv(host: FeatureHost, now: Date): Promise<void> {
  await host.db().from("fediverse_kv").delete().lt("expires_at", now.toISOString());
}
