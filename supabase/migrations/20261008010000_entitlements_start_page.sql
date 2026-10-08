-- Invite codes and the start page (session 4b, 2026-10-08, with Adam).
--
-- WHAT. Five platform tables, none of them hub data:
--
--   entitlements             a right to do something on the platform: today
--                            "create one hub" (kind 'hub.create'), granted by
--                            an invite code the operator mints in the console
--                            (source 'invite'). A later payment creates the
--                            same kind of row (source 'payment'), so the code
--                            is an entitlement, not a password. What it
--                            allows (`kind`), how many (`quantity`, `used`),
--                            until when (`expires_at`). An invite's code is
--                            stored only as its SHA-256 hash; the operator
--                            sees the code once, when it is minted, and the
--                            list shows its last four characters.
--                            `claimed_until` / `claimed_by` hold the row for
--                            the few seconds a create takes, so two creates
--                            cannot both spend one code, and a create that
--                            fails leaves it unused.
--   entitlement_redemptions  each use: who, which hub, when. The hub is
--                            `created_hub_id` — deliberately not `hub_id`,
--                            the tenancy column (as control_audit_log's
--                            `target_hub_id`): a redemption is not the hub's
--                            data. Plain text, not a foreign key, so a
--                            purged hub's history stays (20260927010000).
--   start_codes              the start page's emailed sign-in codes, hashed.
--                            Same rules as a hub's (src/modules/civic.auth/otp.ts).
--   start_sessions           a start-page session, by token hash, opened when
--                            a good invite code is entered and tied to its
--                            entitlement. `email` is null until the person
--                            signs in with an emailed code. Hours, not days.
--   start_attempts           one row per rate-limited attempt (code checks,
--                            code requests, sign-ins, creates), by IP hash or
--                            email hash. In the database, not in memory, so
--                            the limits hold across serverless instances.
--                            Rows older than a day are pruned on write.
--
-- Kinds and sources are checked in code (src/control/entitlements.ts), not
-- by CHECK constraints, so a later payment needs no constraint change.
--
-- NOT HUB-SCOPED, ON PURPOSE: forced RLS and no policy (deny-all to anon and
-- authenticated), no grants to those roles, and each table is listed with its
-- reason in tests/fixtures/tenancyCatalog.ts (NOT_HUB_SCOPED). Only the
-- service role, used for them by src/control/ alone, reads or writes them.
--
-- ADDITIVE. New tables and indexes only.

CREATE TABLE IF NOT EXISTS entitlements (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  used           INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  source         TEXT NOT NULL,
  code_hash      TEXT NULL UNIQUE,
  code_hint      TEXT NULL,
  note           TEXT NULL,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ NULL,
  revoked_by     TEXT NULL,
  claimed_until  TIMESTAMPTZ NULL,
  claimed_by     TEXT NULL,
  CONSTRAINT entitlements_used_le_quantity CHECK (used <= quantity)
);

CREATE INDEX IF NOT EXISTS entitlements_created_at_idx ON entitlements (created_at DESC);

COMMENT ON TABLE entitlements IS
  'A right to do something on the platform (kind hub.create = create one hub). From an invite code (hashed) today, a payment later. Not hub data.';

CREATE TABLE IF NOT EXISTS entitlement_redemptions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entitlement_id  TEXT NOT NULL REFERENCES entitlements(id),
  email           TEXT NOT NULL,
  created_hub_id  TEXT NULL,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entitlement_redemptions_entitlement_idx ON entitlement_redemptions (entitlement_id);

COMMENT ON COLUMN entitlement_redemptions.created_hub_id IS
  'The hub created, as text (not a foreign key, so a purged hub''s history stays).';

CREATE TABLE IF NOT EXISTS start_codes (
  email         TEXT PRIMARY KEY,
  code_hash     TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS start_sessions (
  token_hash      TEXT PRIMARY KEY,
  email           TEXT NULL,
  entitlement_id  TEXT NOT NULL REFERENCES entitlements(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS start_attempts (
  id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket  TEXT NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS start_attempts_bucket_at_idx ON start_attempts (bucket, at DESC);
CREATE INDEX IF NOT EXISTS start_attempts_at_idx ON start_attempts (at);

ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements FORCE ROW LEVEL SECURITY;
ALTER TABLE entitlement_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement_redemptions FORCE ROW LEVEL SECURITY;
ALTER TABLE start_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE start_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE start_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE start_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE start_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE start_attempts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON entitlements, entitlement_redemptions, start_codes, start_sessions, start_attempts FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON entitlements, entitlement_redemptions, start_codes, start_sessions, start_attempts TO service_role;
  END IF;
END $$;
