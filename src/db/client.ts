// @civic-raw-client — CONTROL PLANE AND MIGRATIONS ONLY.
// @civic-raw-client-importer: this is the raw client; it wraps supabase-js.
//
// The raw, service-role Supabase client. It sees every hub's rows. Request
// code reaches tenant data through forHub(hubId) in ./forHub.ts, which wraps
// this client with the hub filter and stamp. Legitimate importers: src/db/
// (forHub itself, the hubs registry), src/control/, and scripts/ that run
// migrations or operator tasks. The `@civic-raw-client` tag above is what the
// Phase 2b `no-restricted-imports` rule keys on; every other importer is a
// module not yet converted (list in HANDOFF.md, Phase 2a entry).
//
// This module initializes one Supabase client using the SERVICE ROLE key.
// The service role key bypasses Row Level Security; it MUST only be used
// server-side. Never import this module from the UI.
//
// Env vars required (see .env.example):
//   SUPABASE_URL                  Project URL (e.g. https://xxx.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY     Service role secret (starts with eyJ…)

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { hubToken } from "./hubToken.js";

let cached: SupabaseClient | null = null;

function read(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required env var: ${name}. ` +
        `Set it in your local .env (see .env.example) or in Vercel project settings.`,
    );
  }
  return v;
}

/**
 * Returns a singleton Supabase client. Lazy — only reads env on first call so
 * that importing this module doesn't crash in contexts (tests, tooling) where
 * env may not be configured yet.
 */
export function getDb(): SupabaseClient {
  if (cached) return cached;

  const url = read("SUPABASE_URL");
  const key = read("SUPABASE_SERVICE_ROLE_KEY");

  cached = createClient(url, key, {
    auth: {
      // We don't use Supabase Auth; we have our own civic.auth module.
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: "public",
    },
  });

  return cached;
}

// --- Minted hub tokens (Phase 3) --------------------------------------------
//
// With CIVIC_HUB_MINTED_TOKEN on, forHub(hubId) talks to PostgREST as the
// `authenticated` role with a short-lived token carrying that hub's id, so the
// forced RLS policies are a second filter behind forHub()'s own. Off (the
// default), forHub() uses the service-role client above, as before Phase 3.
//
// It is an env flag, read on every forHub() call, so switching it off is an
// env change and a redeploy — seconds — not a rollback of the code.
//
// Env vars, only when the flag is on (see .env.example):
//   CIVIC_HUB_SIGNING_KEY      the key PostgREST verifies hub tokens with
//   SUPABASE_PUBLISHABLE_KEY   the project's publishable (or legacy anon)
//                              key; the gateway wants one on every request.
//                              A bare PostgREST needs none.

const ON = new Set(["1", "true", "on", "yes"]);

let pinnedToServiceRole = false;

/**
 * Keep this process on the service role whatever the flag says. Operator
 * scripts call it (scripts/lib/hubScope.ts): the control plane and scripts keep
 * the service role by rule, even when they share an env file with the app.
 */
export function pinServiceRole(): void {
  pinnedToServiceRole = true;
}

/** Whether forHub() should use minted hub tokens right now. */
export function hubTokensEnabled(): boolean {
  if (pinnedToServiceRole) return false;
  return ON.has((process.env.CIVIC_HUB_MINTED_TOKEN ?? "").trim().toLowerCase());
}

/**
 * A client that runs as `authenticated` for one hub. supabase-js asks
 * `accessToken` before every request, so each request carries a current
 * token for exactly this hub. Never cached here; forHub() caches per hub.
 */
export function getHubTokenDb(hubId: string): SupabaseClient {
  const url = read("SUPABASE_URL");
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || "no-gateway-key";
  hubToken(hubId); // mint once now, so a missing or bad key fails here, loudly
  return createClient(url, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
    accessToken: async () => hubToken(hubId),
  });
}
