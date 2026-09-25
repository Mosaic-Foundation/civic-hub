-- The `hubs` table — the tenant registry.
--
-- Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 1. hubs table". The
-- columns and the reserved-slug list below are fixed; changing them is a
-- design decision, not a migration.
--
-- Each row is one hub: a hostname the resolver matches on, plus the identity
-- that is today spread across per-deployment env vars (HUB_NAME,
-- CIVIC_JURISDICTION, CIVIC_JURISDICTION_NAME, CIVIC_SPACE_DID). Moving those
-- into rows is what lets one deployment serve many hubs.
--
-- NOTE ON `hub_id` IN PUBLISHED ACTIVITIES. `hubs.id` is the tenancy slug.
-- It is NOT the protocol identity stamped on activities as `source.hub_id`
-- (CIVIC_HUB_ID, "civic-hub-local" on production). Those are two different
-- identifiers that happen to share a name; this migration does not touch the
-- second one.

CREATE TABLE hubs (
  -- The slug. Also the value stamped into every other table's hub_id in
  -- Phase 2, so it is short, stable, and never reused.
  id                TEXT PRIMARY KEY,
  -- The host the resolver matches on: lowercase, no port, no scheme.
  -- One hostname per hub for now; aliases become a second column later,
  -- never a second row.
  hostname          TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  -- Civic place code, broadest to narrowest (us-va-floyd). NULL means this
  -- hub has no civic geography — the "local"/"none"/"unknown" sentinels the
  -- env var used are never stored here.
  jurisdiction_code TEXT,
  jurisdiction_name TEXT,
  -- The space's stable identifier: generator.id on emitted activities and
  -- space.id in the discovery manifest. Survives the deployment moving.
  space_did         TEXT NOT NULL,
  space_type        TEXT NOT NULL DEFAULT 'civic-hub',
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT hubs_status_check
    CHECK (status IN ('active', 'suspended')),

  -- Slug shape: lowercase alphanumerics and hyphens, 2-32 characters, never
  -- starting or ending with a hyphen.
  CONSTRAINT hubs_id_format_check
    CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$'),

  -- Reserved slugs. These are hostnames the platform itself needs, or ones
  -- that would be confusing or impersonating as a hub. Enforced here so no
  -- code path can assign one, and again in the control-plane validator so
  -- an operator gets a readable error instead of a constraint violation.
  CONSTRAINT hubs_id_not_reserved_check
    CHECK (id NOT IN (
      'www', 'admin', 'api', 'polis', 'representative',
      'demo', 'staging', 'dev', 'mail', 'app'
    )),

  -- Hostnames are compared after lowercasing in the resolver, so storing a
  -- mixed-case one would create a row that can never be matched.
  CONSTRAINT hubs_hostname_lowercase_check
    CHECK (hostname = lower(hostname)),

  CONSTRAINT hubs_space_did_check
    CHECK (space_did ~ '^did:[a-z0-9]+:.+')
);

CREATE TRIGGER hubs_updated_at
  BEFORE UPDATE ON hubs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The resolver's only query: hostname -> row. Already covered by the UNIQUE
-- constraint's index, so no second index here.

-- RLS matches every other table: on, forced, no permissive policies. The
-- resolver reads `hubs` with the service role, which bypasses RLS. `hubs`
-- deliberately gets no hub_id in Phase 2 — it is the registry, not tenant
-- data, and it is never exposed through the hub-scoped client.
ALTER TABLE hubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hubs FORCE  ROW LEVEL SECURITY;

-- Explicit, per the convention this phase establishes. See
-- 20260922000000_grant_table_privileges.sql for why relying on default
-- privileges is not enough.
-- Guarded (Phase 2c): these are Supabase's role names; on plain Postgres
-- they do not exist, and the grant is skipped rather than failing the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hubs TO authenticated, service_role;
  END IF;
END $$;

-- Hub #1. These are the values Floyd's production deployment carries in
-- HUB_NAME, CIVIC_JURISDICTION, CIVIC_JURISDICTION_NAME and CIVIC_SPACE_DID
-- today; the row is the same configuration, moved from the environment into
-- the database. Idempotent so re-running against a database that already has
-- it is safe.
INSERT INTO hubs (id, hostname, name, jurisdiction_code, jurisdiction_name, space_did)
VALUES (
  'floyd',
  'floyd.civic.social',
  'Floyd Civic Hub',
  'us-va-floyd',
  'Floyd County, Virginia',
  'did:web:floyd.civic.social'
)
ON CONFLICT (id) DO NOTHING;
