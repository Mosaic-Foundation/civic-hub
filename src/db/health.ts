// @civic-raw-client-importer: the health probe checks the connection itself, before any hub is known.
//
// Database connectivity for GET /health. Lives in src/db/ so the route layer
// (src/app.ts) never holds the raw client.

import { getDb } from "./client.js";
import { forHub, hubDbMode } from "./forHub.js";

/**
 * Lightweight connectivity probe. Returns `{ ok: true }` on success,
 * `{ ok: false, error }` on failure. Used by /health.
 */
export async function pingDb(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    // HEAD + count is the cheapest query that proves the connection works
    // and RLS policy is respected by the service role.
    const { error } = await getDb()
      .from("users")
      .select("id", { count: "exact", head: true });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * How forHub() reaches the database for this hub, and — when that is a
 * minted hub token — whether PostgREST accepts it. A token PostgREST cannot
 * verify (the wrong key, or a key the project does not hold) fails every hub
 * query, so /health reports it rather than letting the first page find out.
 */
export async function pingHubDb(hubId: string | null): Promise<
  { mode: "hub_token" | "service_role"; ok: boolean; error?: string }
> {
  const mode = hubDbMode();
  if (mode === "service_role" || !hubId) return { mode, ok: true };
  try {
    await forHub(hubId).from("hub_settings").count();
    return { mode, ok: true };
  } catch (e) {
    return { mode, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
