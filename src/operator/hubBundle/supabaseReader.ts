// @civic-raw-client-importer: an export reads one hub's rows from every table and its objects from the bucket, as the service role.
//
// The exporter's row reader over the deployment's own database: rows through
// PostgREST (paged, key-ordered). What the console uses, and
// scripts/export-hub.ts by default. The object reader is the hosting layer's
// (supabaseObjectReader in src/hosting/supabaseStorage.ts).

import { getDb } from "../../db/client.js";
import type { HubRowReader } from "./export.js";
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
