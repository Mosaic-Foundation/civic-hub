// @civic-raw-client-importer: an export reads one hub's rows from every table and its objects from the bucket, as the service role.
//
// The exporter's readers over the deployment's own Supabase project: rows
// through PostgREST (paged, key-ordered), objects through Storage. What the
// console uses, and scripts/export-hub.ts by default.

import { getDb } from "../../db/client.js";
import type { HubRowReader, ObjectReader } from "./export.js";
import type { Row } from "./format.js";

const PAGE = 1000;

export function supabaseRowReader(): HubRowReader {
  return {
    kind: "supabase",
    async hubRow(hubId) {
      const { data, error } = await getDb().from("hubs").select("*").eq("id", hubId).maybeSingle();
      if (error) throw new Error(`export: reading hubs failed: ${error.message}`);
      return (data as Row | null) ?? null;
    },
    async tableRows(table, hubId, key) {
      const out: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = getDb().from(table).select("*").eq("hub_id", hubId);
        for (const k of key) q = q.order(k, { ascending: true });
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw new Error(`export: reading ${table} failed: ${error.message}`);
        out.push(...((data ?? []) as Row[]));
        if (!data || data.length < PAGE) return out;
      }
    },
  };
}

export function supabaseObjectReader(bucket: string): ObjectReader {
  const base = process.env.SUPABASE_URL;
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
