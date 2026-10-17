// The one place the hub reads its environment (Audit 4, F7).
//
// Every variable the server and api/ read is named here, once, with what it
// is for; `.env.example` documents the values. Code elsewhere reads `env.X`,
// and the lint rule `no-restricted-properties` (eslint.config.js) refuses
// `process.env` anywhere else in src/ and api/. Scripts and tests read their
// own environment and are not covered.
//
// Each read happens at access time, not at import: tests and the dev server
// set variables after modules load, and a serverless instance sees the
// deployment's values on every access. A value is trimmed; an empty one reads
// as unset.
//
// Development-only switches (CIVIC_ALLOW_SEED, CIVIC_RATE_LIMITS,
// CIVIC_SSRF_ALLOW_PRIVATE, CIVIC_POLIS_FAKE, CIVIC_COC_FAKE) are read here but decided in src/config/devFlags.ts,
// which refuses them in production (Audit 2).

function read(name: string): string | undefined {
  // eslint-disable-next-line no-restricted-properties -- the one reader
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** A variable named at run time: hub-setting fallbacks and required-variable checks only. */
export function envVar(name: string): string | undefined {
  return read(name);
}

/**
 * The whole environment, for functions that take it as an injectable
 * parameter (tests pass their own): `fn(env = processEnv())`.
 */
export function processEnv(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-properties -- the one reader
  return process.env;
}

export const env = {
  // --- Runtime ---------------------------------------------------------------
  /** "production" on every Vercel deployment (dev and production). */
  get NODE_ENV() { return read("NODE_ENV"); },
  /** Local server port (default 3000). */
  get PORT() { return read("PORT"); },

  // --- Database --------------------------------------------------------------
  get SUPABASE_URL() { return read("SUPABASE_URL"); },
  get SUPABASE_SERVICE_ROLE_KEY() { return read("SUPABASE_SERVICE_ROLE_KEY"); },
  /** Sent with minted hub tokens (Phase 3). */
  get SUPABASE_PUBLISHABLE_KEY() { return read("SUPABASE_PUBLISHABLE_KEY"); },
  /** "true": hub queries run as `authenticated` under a minted hub token (forced RLS). */
  get CIVIC_HUB_MINTED_TOKEN() { return read("CIVIC_HUB_MINTED_TOKEN"); },
  /** The key hub tokens are signed with (the project's JWT secret). */
  get CIVIC_HUB_SIGNING_KEY() { return read("CIVIC_HUB_SIGNING_KEY"); },

  // --- Addresses -------------------------------------------------------------
  /** The API's own origin, outside a hub (scripts, local). */
  get BASE_URL() { return read("BASE_URL"); },
  /** The UI's origin when it differs from the API's (local preview, the start page's handoff). */
  get CIVIC_UI_BASE_URL() { return read("CIVIC_UI_BASE_URL"); },
  /** Extra CORS origins, comma-separated. */
  get CIVIC_ALLOWED_ORIGINS() { return read("CIVIC_ALLOWED_ORIGINS"); },
  /** The super admin console's hostname. */
  get CIVIC_CONSOLE_HOSTNAME() { return read("CIVIC_CONSOLE_HOSTNAME"); },
  /** The console's one operator. */
  get CIVIC_CONSOLE_ADMIN_EMAIL() { return read("CIVIC_CONSOLE_ADMIN_EMAIL"); },
  /** The start page's hostname (session 4b). */
  get CIVIC_START_HOSTNAME() { return read("CIVIC_START_HOSTNAME"); },
  /** Local development: the hub a bare localhost resolves to. */
  get CIVIC_DEV_HUB() { return read("CIVIC_DEV_HUB"); },

  // --- Deployment-wide identity fallbacks (a hub's own rows win) --------------
  get CIVIC_HUB_ID() { return read("CIVIC_HUB_ID"); },
  get HUB_NAME() { return read("HUB_NAME"); },
  get CIVIC_JURISDICTION() { return read("CIVIC_JURISDICTION"); },
  get CIVIC_JURISDICTION_NAME() { return read("CIVIC_JURISDICTION_NAME"); },
  get CIVIC_SPACE_DID() { return read("CIVIC_SPACE_DID"); },
  /** api/og.ts's fallbacks when /hub-config cannot be read. */
  get VITE_HUB_PAGE_TITLE() { return read("VITE_HUB_PAGE_TITLE"); },
  get VITE_HUB_BANNER_URL() { return read("VITE_HUB_BANNER_URL"); },

  // --- Secrets ---------------------------------------------------------------
  /** Per-process anonymous tokens (redaction, "Resident N"). */
  get CIVIC_ANON_SECRET() { return read("CIVIC_ANON_SECRET"); },
  /** Bearer for /internal/* jobs (Vercel Cron). */
  get CRON_SECRET() { return read("CRON_SECRET"); },
  /** Signs digest unsubscribe links. */
  get DIGEST_UNSUBSCRIBE_SECRET() { return read("DIGEST_UNSUBSCRIBE_SECRET"); },

  // --- Outside services ------------------------------------------------------
  get ANTHROPIC_API_KEY() { return read("ANTHROPIC_API_KEY"); },
  get ANTHROPIC_MODEL() { return read("ANTHROPIC_MODEL"); },
  get RESEND_API_KEY() { return read("RESEND_API_KEY"); },
  get RESEND_FROM() { return read("RESEND_FROM"); },
  /** Older name for RESEND_FROM. */
  get SMTP_FROM() { return read("SMTP_FROM"); },
  get POLIS_AUTH_TOKEN() { return read("POLIS_AUTH_TOKEN"); },
  get SEARCHAPI_API_KEY() { return read("SEARCHAPI_API_KEY"); },
  get SUPADATA_API_KEY() { return read("SUPADATA_API_KEY"); },
  get LINK_PREVIEW_USER_AGENT() { return read("LINK_PREVIEW_USER_AGENT"); },

  // --- Limits and switches ---------------------------------------------------
  get IMAGE_UPLOAD_MAX_MB() { return read("IMAGE_UPLOAD_MAX_MB"); },
  /** "false" stops every scheduled job on this deployment. */
  get HUB_CRON_ENABLED() { return read("HUB_CRON_ENABLED"); },
  /** Local seeding: which fixture auto-seed loads. */
  get CIVIC_SEED_FIXTURE() { return read("CIVIC_SEED_FIXTURE"); },
  /** Development only (devFlags.ts). */
  get CIVIC_ALLOW_SEED() { return read("CIVIC_ALLOW_SEED"); },
  get CIVIC_RATE_LIMITS() { return read("CIVIC_RATE_LIMITS"); },
  get CIVIC_SSRF_ALLOW_PRIVATE() { return read("CIVIC_SSRF_ALLOW_PRIVATE"); },
  get CIVIC_POLIS_FAKE() { return read("CIVIC_POLIS_FAKE"); },
  get CIVIC_COC_FAKE() { return read("CIVIC_COC_FAKE"); },

  // --- Operations (operations shell, ADR-006) --------------------------------
  /** Sentry DSN. Unset: errors go to the log only (src/utils/errorTracking.ts). */
  get CIVIC_ERROR_DSN() { return read("CIVIC_ERROR_DSN"); },
  /** "production" or "dev": the environment tag on every error. */
  get CIVIC_ERROR_ENVIRONMENT() { return read("CIVIC_ERROR_ENVIRONMENT"); },
  /** Healthchecks.io ping key. Unset: scheduled jobs ping no heartbeat (src/utils/heartbeat.ts). */
  get CIVIC_HEARTBEAT_PING_KEY() { return read("CIVIC_HEARTBEAT_PING_KEY"); },

  // --- The console reads the operations services (dashboard, ADR-007) -------
  // Each unset shows its Dashboard card as "not connected"; never required.
  /** Healthchecks.io project's read-only API key: the backup's last dump. */
  get HEALTHCHECKS_READ_KEY() { return read("HEALTHCHECKS_READ_KEY"); },
  /** Better Stack Uptime API token: monitors' status. Unset until a read-only token exists (ADR-007). */
  get BETTERSTACK_API_TOKEN() { return read("BETTERSTACK_API_TOKEN"); },
  /** Sentry user auth token with project:read and event:read only: the last 24 hours' errors. */
  get SENTRY_READ_TOKEN() { return read("SENTRY_READ_TOKEN"); },
  /** Sentry organization and project slugs, for SENTRY_READ_TOKEN. */
  get SENTRY_ORG() { return read("SENTRY_ORG"); },
  get SENTRY_PROJECT() { return read("SENTRY_PROJECT"); },
  /** Dev only: the Dashboard reads hubs' /health from this server, and "slow" hubs time out (src/control/dashboard/hubHealth.ts). */
  get CIVIC_DASHBOARD_FAKE() { return read("CIVIC_DASHBOARD_FAKE"); },

  // --- What is deployed ------------------------------------------------------
  get VERCEL_GIT_COMMIT_SHA() { return read("VERCEL_GIT_COMMIT_SHA"); },
  get GIT_COMMIT_SHA() { return read("GIT_COMMIT_SHA"); },
  get VERCEL_DEPLOYMENT_ID() { return read("VERCEL_DEPLOYMENT_ID"); },
  get DEPLOYMENT_ID() { return read("DEPLOYMENT_ID"); },
} as const;

/** NODE_ENV=production: every Vercel deployment. Development flags are refused there. */
export function isProductionEnv(): boolean {
  return env.NODE_ENV === "production";
}
