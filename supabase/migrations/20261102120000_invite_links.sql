-- Pilot readiness 2 (2026-11-02): an invite the console emailed is a link that
-- signs the person in as the address it went to, with no second code.
--
--   entitlement_links  one row per email sent: the link's token by hash, the
--                      address it went to, and when it stops working (the
--                      code's own end date). spent_at is set the first time it
--                      is followed; a later click is refused and points to the
--                      code printed in the same email.
--
-- NOT HUB-SCOPED, ON PURPOSE: as the other start-page tables (20261008010000),
-- forced RLS and no policy, no grants to anon or authenticated, listed in
-- tests/fixtures/tenancyCatalog.ts. Additive. Applies twice without error.

CREATE TABLE IF NOT EXISTS entitlement_links (
  token_hash      TEXT PRIMARY KEY,
  entitlement_id  TEXT NOT NULL REFERENCES entitlements(id),
  email           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  spent_at        TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS entitlement_links_entitlement ON entitlement_links (entitlement_id);

ALTER TABLE entitlement_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement_links FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON entitlement_links FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON entitlement_links TO service_role;
  END IF;
END $$;
