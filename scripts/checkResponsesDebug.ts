import { getDb } from "../src/db/client.js";
const db = getDb();
const { data, error } = await db
  .from("events")
  .select("id, event_type, created_at, data")
  .eq("process_id", "proc_09713c46665c4297")
  .order("created_at", { ascending: false })
  .limit(6);
if (error) console.error("query error:", error.message);
console.log(JSON.stringify((data ?? []).map((e: any) => ({
  event_type: e.event_type, created_at: e.created_at,
  action: e.data?.action, feed_anchor: e.data?.feed_anchor,
  excerpt: e.data?.response?.excerpt, office: e.data?.response?.official_title,
  responder: e.data?.response?.responder_name,
})), null, 2));
