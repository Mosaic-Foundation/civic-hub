// Every setting the server reads from its environment, declared once
// (Architecture 5, ADR-012). Each has its purpose, its type, its default and
// whether it is required; checkSettings() (./checkSettings.ts) validates them
// at startup, and scripts/settings-doc.ts prints this table into
// RUNBOOK-operations.md → "Settings". Values are read only through ./env.ts.
//
// `layer` says who may read a setting:
//   engine   the hub itself: anything in src/ through `env`.
//   hosting  an outside service or the host: only src/hosting/, src/control/
//            and api/ through `hostingEnv` (lint: civic/hosting-boundary).
//   dev      development switches, refused in production (./devFlags.ts).
//
// Adding a setting: declare it here, read it as env.X (or hostingEnv.X), and
// run `npm run settings:doc`. A name not declared here is reported at startup
// as unknown when it carries one of KNOWN_PREFIXES.

export type SettingType = "string" | "secret" | "url" | "urls" | "integer" | "number" | "boolean" | "email";

/**
 * `always`: the server refuses to start without it.
 * `production`: refused without it when NODE_ENV=production (every Vercel
 * deployment, dev included).
 * `{ when, production? }`: required only when another setting is on.
 */
export type Required = "always" | "production" | { when: string; production?: boolean };

export interface SettingDecl {
  readonly purpose: string;
  readonly type: SettingType;
  readonly layer: "engine" | "hosting" | "dev";
  /** What the code uses when unset (documentation; env.X returns undefined). */
  readonly default?: string;
  readonly required?: Required;
  /** Older names, read in order when this one is unset. */
  readonly aliases?: readonly string[];
  /** Names a host sets for us, read BEFORE this one (Vercel's, today). */
  readonly hostNames?: readonly string[];
}

const s = <T extends Record<string, SettingDecl>>(t: T) => t;

export const SETTINGS = s({
  // --- Runtime ---------------------------------------------------------------
  NODE_ENV: { purpose: "\"production\" on every deployment (dev and production); development switches are refused there.", type: "string", layer: "engine", default: "development" },
  PORT: { purpose: "The local server's port.", type: "integer", layer: "engine", default: "3000" },

  // --- Database (Postgres behind PostgREST) ----------------------------------
  SUPABASE_URL: { purpose: "The database's PostgREST origin (a Supabase project URL, or a PostgREST behind /rest/v1).", type: "url", layer: "engine", required: "always" },
  SUPABASE_SERVICE_ROLE_KEY: { purpose: "The service-role key PostgREST accepts. Server only.", type: "secret", layer: "engine", required: "always" },
  SUPABASE_PUBLISHABLE_KEY: { purpose: "The gateway's publishable key, sent with minted hub tokens. A bare PostgREST needs none.", type: "string", layer: "engine" },
  CIVIC_HUB_MINTED_TOKEN: { purpose: "On: hub queries run as `authenticated` under a minted hub token, so forced RLS is live.", type: "boolean", layer: "engine", default: "false" },
  CIVIC_HUB_SIGNING_KEY: { purpose: "The key hub tokens are signed with (PostgREST's JWT secret or a private JWK).", type: "secret", layer: "engine", required: { when: "CIVIC_HUB_MINTED_TOKEN" } },

  // --- Addresses -------------------------------------------------------------
  BASE_URL: { purpose: "The API's own origin outside a hub (scripts, local).", type: "url", layer: "engine", default: "http://localhost:3000" },
  CIVIC_UI_BASE_URL: { purpose: "The UI's origin when it differs from the API's (local preview, the start page's handoff).", type: "url", layer: "engine", default: "BASE_URL" },
  CIVIC_ALLOWED_ORIGINS: { purpose: "Extra CORS origins, comma-separated. Unset outside production allows any origin.", type: "urls", layer: "engine", required: "production" },
  CIVIC_CONSOLE_HOSTNAME: { purpose: "The console's hostname. Unset: no console on this deployment.", type: "string", layer: "engine" },
  CIVIC_CONSOLE_ADMIN_EMAIL: { purpose: "The console's one operator.", type: "email", layer: "engine", required: { when: "CIVIC_CONSOLE_HOSTNAME" } },
  CIVIC_START_HOSTNAME: { purpose: "The start page's hostname. Unset: no start page.", type: "string", layer: "engine" },
  CIVIC_DEV_HUB: { purpose: "Local development: the hub a bare localhost resolves to.", type: "string", layer: "dev", default: "athens" },

  // --- Deployment-wide identity fallbacks (a hub's own row wins) -------------
  CIVIC_HUB_ID: { purpose: "Fallback hub id for code with no hub in scope.", type: "string", layer: "engine" },
  HUB_NAME: { purpose: "Fallback hub name (also a hub-setting fallback).", type: "string", layer: "engine" },
  CIVIC_JURISDICTION: { purpose: "Fallback place code for code with no hub in scope.", type: "string", layer: "engine" },
  CIVIC_JURISDICTION_NAME: { purpose: "Fallback place name for CIVIC_JURISDICTION.", type: "string", layer: "engine" },
  CIVIC_SPACE_DID: { purpose: "Fallback space DID; each hub's row carries its own.", type: "string", layer: "engine" },
  CIVIC_PLATFORM_POSTAL_ADDRESS: { purpose: "The platform's postal address, printed in a digest footer when the hub has none.", type: "string", layer: "engine" },
  VITE_HUB_PAGE_TITLE: { purpose: "Share-card fallback title when /hub-config cannot be read (api/og.ts; also a hub-setting fallback).", type: "string", layer: "hosting" },
  VITE_HUB_BANNER_URL: { purpose: "Share-card fallback image (api/og.ts; also a hub-setting fallback).", type: "string", layer: "hosting" },

  // --- Secrets ---------------------------------------------------------------
  CIVIC_ANON_SECRET: { purpose: "Keys the per-process anonymous tokens on the public wire. Unset: every resident reads as one shared \"anonymous\".", type: "secret", layer: "engine", required: "production" },
  CRON_SECRET: { purpose: "Bearer token for /internal/* job routes. Unset: no job route accepts a call.", type: "secret", layer: "engine", required: "production" },
  DIGEST_UNSUBSCRIBE_SECRET: { purpose: "Signs digest unsubscribe links (16 characters or more). Unset: the digest job fails.", type: "secret", layer: "engine", required: "production" },

  // --- Outside services (src/hosting/) ---------------------------------------
  ANTHROPIC_API_KEY: { purpose: "The AI adapter's Anthropic key. Unset: AI features answer \"not set up\".", type: "secret", layer: "hosting" },
  ANTHROPIC_MODEL: { purpose: "The model the AI adapter asks.", type: "string", layer: "hosting", default: "claude-sonnet-4-6" },
  RESEND_API_KEY: { purpose: "The mail adapter's Resend key. Unset: mail is logged, not sent.", type: "secret", layer: "hosting" },
  RESEND_FROM: { purpose: "Default From address (a hub's own setting wins).", type: "string", layer: "hosting", aliases: ["SMTP_FROM"] },
  POLIS_AUTH_TOKEN: { purpose: "The deliberation adapter's Polis service token.", type: "secret", layer: "hosting" },
  SEARCHAPI_API_KEY: { purpose: "Video adapter: SearchAPI transcripts (second choice).", type: "secret", layer: "hosting" },
  SUPADATA_API_KEY: { purpose: "Video adapter: Supadata transcripts (first choice).", type: "secret", layer: "hosting" },
  SUPABASE_STORAGE_BUCKET: { purpose: "The object store's public bucket for post images (the name predates the adapter; any store uses it).", type: "string", layer: "engine", default: "post-images" },
  CIVIC_OBJECT_STORE: { purpose: "Which object store: \"supabase\" (Supabase Storage on the database's project) or \"memory\" (nothing kept across restarts; the run-anywhere CI job).", type: "string", layer: "hosting", default: "supabase" },
  LINK_PREVIEW_USER_AGENT: { purpose: "User-Agent sent when fetching link previews.", type: "string", layer: "engine" },

  // --- Limits and switches ---------------------------------------------------
  IMAGE_UPLOAD_MAX_MB: { purpose: "Upload size limit in MB, capped by the code's ceiling.", type: "number", layer: "engine" },
  HUB_CRON_ENABLED: { purpose: "\"false\" stops every scheduled job on this deployment.", type: "boolean", layer: "engine", default: "true" },
  CIVIC_SEED_FIXTURE: { purpose: "Local seeding: which fixture auto-seed loads.", type: "string", layer: "dev" },
  CIVIC_ALLOW_SEED: { purpose: "Development: allow /debug/seed.", type: "boolean", layer: "dev" },
  CIVIC_RATE_LIMITS: { purpose: "Development: \"off\" disables rate limits.", type: "string", layer: "dev" },
  CIVIC_SSRF_ALLOW_PRIVATE: { purpose: "Development: let link fetches reach private addresses.", type: "boolean", layer: "dev" },
  CIVIC_FAKE_ADAPTERS: { purpose: "Development: every outside service is its in-memory fake (src/adapters/fakes/).", type: "boolean", layer: "dev" },
  CIVIC_POLIS_FAKE: { purpose: "Development, alias kept for one release: the deliberation adapter only is its fake.", type: "boolean", layer: "dev" },
  CIVIC_COC_FAKE: { purpose: "Development, alias kept for one release: the Code of Conduct check only is answered by the fake AI.", type: "boolean", layer: "dev" },
  CIVIC_DASHBOARD_FAKE: { purpose: "Development: the console's Dashboard reads hubs' /health from this server.", type: "boolean", layer: "dev" },
  CIVIC_PLUGINS_UNVERIFIED: { purpose: "Development: mount every configured plugin package without an approved catalog row (catalog:add's conformance run).", type: "boolean", layer: "dev" },

  // --- Operations (ADR-006, ADR-007) -----------------------------------------
  CIVIC_ERROR_DSN: { purpose: "The errors adapter's Sentry DSN. Unset: errors go to the log only.", type: "secret", layer: "hosting" },
  CIVIC_ERROR_ENVIRONMENT: { purpose: "The environment tag on every error (\"production\" or \"dev\").", type: "string", layer: "hosting" },
  CIVIC_HEARTBEAT_PING_KEY: { purpose: "The heartbeat adapter's Healthchecks.io ping key. Unset: jobs ping nothing.", type: "secret", layer: "hosting" },
  HEALTHCHECKS_READ_KEY: { purpose: "Console: Healthchecks.io read-only key (the backup card).", type: "secret", layer: "hosting" },
  BETTERSTACK_API_TOKEN: { purpose: "Console: Better Stack token (the uptime card).", type: "secret", layer: "hosting" },
  SENTRY_READ_TOKEN: { purpose: "Console: Sentry read token (the errors card).", type: "secret", layer: "hosting" },
  SENTRY_ORG: { purpose: "Console: Sentry organization slug.", type: "string", layer: "hosting" },
  SENTRY_PROJECT: { purpose: "Console: Sentry project slug.", type: "string", layer: "hosting" },

  // --- What is deployed ------------------------------------------------------
  GIT_COMMIT_SHA: { purpose: "The deployed commit (/health, error releases).", type: "string", layer: "engine", default: "unknown", hostNames: ["VERCEL_GIT_COMMIT_SHA"] },
  DEPLOYMENT_ID: { purpose: "The deployment's id (/health).", type: "string", layer: "engine", hostNames: ["VERCEL_DEPLOYMENT_ID"] },
});

export type SettingName = keyof typeof SETTINGS;
export type EngineSettingName = { [K in SettingName]: (typeof SETTINGS)[K]["layer"] extends "hosting" ? never : K }[SettingName];
export type HostingSettingName = { [K in SettingName]: (typeof SETTINGS)[K]["layer"] extends "hosting" ? K : never }[SettingName];

/**
 * Prefixes that mark a name as ours. A set variable with one of these that is
 * neither declared above, an alias, nor a hub-setting fallback is reported as
 * unknown at startup (usually a typo or a setting nothing reads any more).
 */
export const KNOWN_PREFIXES = [
  "CIVIC_", "SUPABASE_", "ANTHROPIC_", "RESEND_", "POLIS_", "SENTRY_", "HEALTHCHECKS_", "BETTERSTACK_",
  "SEARCHAPI_", "SUPADATA_", "DIGEST_", "MEETING_", "HUB_", "IMAGE_UPLOAD_", "LINK_PREVIEW_",
] as const;
