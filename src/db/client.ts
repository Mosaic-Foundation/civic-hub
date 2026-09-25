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
