-- Jurisdictions: a platform-wide reference list, and hubs pointing at it
-- (2026-09-27, with Adam). Plan: BUILD-PLAN-multi-tenant.md → "Jurisdictions".
--
-- WHAT.
--
--   jurisdictions          every US state, county, city, town, village,
--                          borough, census-designated place and school
--                          district, keyed by its Open Civic Data division
--                          id, with its Census GEOID, state, type, the
--                          Census's official name and our display name
--                          ("Town of Floyd, Virginia").
--   hubs.jurisdiction_ocd_id    the jurisdiction a hub serves, or null.
--                          Several hubs may serve one jurisdiction; there is
--                          no uniqueness on it.
--   hubs.jurisdiction_custom    true when the operator chose "Other / not
--                          listed" (a neighbourhood, a tribal nation, an
--                          association): a name but no OCD id, on purpose.
--                          False with a null id means "not linked yet",
--                          which is every hub created before this migration.
--
-- THE ROWS ARE NOT HERE. The table is created empty; scripts/load-jurisdictions.ts
-- loads it from the committed file config/jurisdictions/us-jurisdictions.csv,
-- checking its sha256, on any install, plain Postgres included. Fifty
-- thousand rows do not belong in a migration.
--
-- READ-ONLY, AND NOT HUB DATA. No hub_id: it is the same list for every hub.
-- Forced RLS with no policy (deny-all to anon and authenticated, like
-- `hubs`); the service role (the console) may only SELECT; only the owner —
-- the loader's direct connection — writes. Listed with its reason in
-- tests/fixtures/tenancyCatalog.ts (NOT_HUB_SCOPED).
--
-- ADDITIVE. One new table, two nullable/defaulted columns, one check, one
-- index. Floyd's id is set by a data step after the load (the console's hub
-- page, audited), not here: the row it points at does not exist until then.

CREATE TABLE IF NOT EXISTS jurisdictions (
  ocd_id        TEXT PRIMARY KEY CHECK (ocd_id LIKE 'ocd-division/country:us%'),
  census_geoid  TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state ~ '^[a-z]{2}$'),
  type          TEXT NOT NULL CHECK (type IN (
                  'state', 'county', 'city', 'town', 'village', 'borough', 'cdp', 'school_district'
                )),
  official_name TEXT NOT NULL,
  display_name  TEXT NOT NULL
);

COMMENT ON TABLE jurisdictions IS
  'Reference list: US jurisdictions by OCD division id. Loaded by scripts/load-jurisdictions.ts; read-only to the app. Not hub data.';

-- The console's picker: state, then type, then a name prefix.
CREATE INDEX IF NOT EXISTS jurisdictions_state_type_name_idx
  ON jurisdictions (state, type, lower(official_name) text_pattern_ops);

ALTER TABLE jurisdictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE jurisdictions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON jurisdictions FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON jurisdictions FROM service_role;
    GRANT SELECT ON jurisdictions TO service_role;
  END IF;
END $$;

-- Deny-all RLS does not bind the service role (BYPASSRLS), so its SELECT
-- works; the grants above keep it from writing.

ALTER TABLE hubs ADD COLUMN IF NOT EXISTS jurisdiction_ocd_id TEXT NULL REFERENCES jurisdictions (ocd_id);
ALTER TABLE hubs ADD COLUMN IF NOT EXISTS jurisdiction_custom BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hubs_jurisdiction_custom_check') THEN
    ALTER TABLE hubs ADD CONSTRAINT hubs_jurisdiction_custom_check
      CHECK (NOT (jurisdiction_custom AND jurisdiction_ocd_id IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS hubs_jurisdiction_ocd_id_idx ON hubs (jurisdiction_ocd_id);

COMMENT ON COLUMN hubs.jurisdiction_ocd_id IS
  'The jurisdiction this hub serves (jurisdictions.ocd_id), or null: custom (jurisdiction_custom) or not linked yet. Not unique.';
COMMENT ON COLUMN hubs.jurisdiction_custom IS
  'True when the operator chose "Other / not listed": jurisdiction_name is free text and there is no OCD id.';
