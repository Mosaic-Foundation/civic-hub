-- The super admin (control plane), Phase 5 part one (2026-09-26, with Adam).
--
-- WHAT. One column on the registry and three tables that belong to the
-- platform, not to any hub:
--
--   hubs.archived_at     when a hub was retired. Archiving sets it AND sets
--                        status = 'suspended' (the resolver already serves the
--                        "paused" page for that). Unarchiving clears it. There
--                        is no hard delete: that comes with the later
--                        lifecycle work (export first, a retention window).
--                        An archived hub keeps its slug and hostname forever,
--                        because old links, published events and DID
--                        documents point at them; the row, and so its unique
--                        id and hostname, stay.
--   control_codes        the emailed one-time codes for the super admin's
--                        sign-in and step-up. Same rules as a hub's sign-in
--                        (src/modules/civic.auth/otp.ts), but the code is
--                        stored hashed, and the table is not hub data.
--   control_sessions     super admin sessions, by token hash.
--   control_audit_log    every super admin action: who, what, which hub, the
--                        values before and after. Append-only: a trigger
--                        refuses UPDATE and DELETE for every role, the service
--                        role included.
--
-- NOT HUB-SCOPED, ON PURPOSE. None of the three has hub_id: they are the
-- platform's own records. An audit row names the hub it acted on in
-- `target_hub_id` — deliberately not `hub_id`, the tenancy column every
-- hub-scoped table carries — but is not that hub's data and must not be
-- readable by it. They get forced RLS and NO policy —
-- deny-all to anon and authenticated, the same treatment as `hubs` — and are
-- listed with their reasons in tests/fixtures/tenancyCatalog.ts
-- (NOT_HUB_SCOPED), which the catalog test holds them to. Only the service
-- role, which only src/control/ uses for them, can read or write them.
--
-- ADDITIVE. One nullable column, three new tables, one trigger function.

ALTER TABLE hubs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN hubs.archived_at IS
  'When the super admin archived this hub (status is also suspended). Null while not archived. Slug and hostname stay taken.';

CREATE TABLE IF NOT EXISTS control_codes (
  email         TEXT NOT NULL,
  purpose       TEXT NOT NULL CHECK (purpose IN ('sign_in', 'step_up')),
  code_hash     TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ NULL,
  PRIMARY KEY (email, purpose)
);

CREATE TABLE IF NOT EXISTS control_sessions (
  token_hash    TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS control_sessions_email_idx ON control_sessions (email);

CREATE TABLE IF NOT EXISTS control_audit_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_email   TEXT NOT NULL,
  action        TEXT NOT NULL,
  target_hub_id TEXT NULL REFERENCES hubs(id),
  before        JSONB NULL,
  after         JSONB NULL
);

CREATE INDEX IF NOT EXISTS control_audit_log_target_hub_at_idx ON control_audit_log (target_hub_id, at DESC);
CREATE INDEX IF NOT EXISTS control_audit_log_at_idx ON control_audit_log (at DESC);

COMMENT ON TABLE control_audit_log IS
  'Every super admin action. Append-only (trigger). Not hub data: no hub_id policy, deny-all RLS.';

CREATE OR REPLACE FUNCTION public._control_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'control_audit_log is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS control_audit_log_append_only ON control_audit_log;
CREATE TRIGGER control_audit_log_append_only
  BEFORE UPDATE OR DELETE ON control_audit_log
  FOR EACH ROW EXECUTE FUNCTION public._control_audit_log_append_only();

ALTER TABLE control_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE control_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE control_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_audit_log FORCE ROW LEVEL SECURITY;

-- Belt and braces on top of deny-all RLS: the hub-facing roles get no
-- privileges at all. Guarded, as elsewhere: these roles exist on Supabase,
-- not on plain Postgres.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON control_codes, control_sessions, control_audit_log FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON control_codes, control_sessions TO service_role;
    GRANT SELECT, INSERT ON control_audit_log TO service_role;
  END IF;
END $$;
