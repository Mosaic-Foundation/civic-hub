-- hub_settings becomes per-hub: primary key (hub_id, key).
--
-- Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 2. hub_settings".
--
-- Additive and ordered so it is safe against a live database: add the column
-- with a default, backfill, constrain, then swap the primary key. Existing
-- rows all belong to Floyd, which is hub #1 and the only hub that has ever
-- written a settings row.
--
-- The DEFAULT 'floyd' is a migration device, not the design. It exists so a
-- write from code that has not yet been converted cannot fail or land
-- without a hub. Phase 2 drops it once every writer passes a hub explicitly
-- (see the build plan's Phase 2 checklist), at which point a missing hub_id
-- becomes the error it should be.

ALTER TABLE hub_settings
  ADD COLUMN IF NOT EXISTS hub_id TEXT NOT NULL DEFAULT 'floyd';

-- Backfill is implicit in the DEFAULT above for existing rows; this is here
-- so the intent survives a reader who skips the column definition, and so a
-- re-run after a partial application still converges.
UPDATE hub_settings SET hub_id = 'floyd' WHERE hub_id IS NULL OR hub_id = '';

-- Every settings row must belong to a hub that exists. ON DELETE CASCADE:
-- deleting a hub takes its settings with it, because a settings row for a
-- hub that is gone is not data, it is litter.
ALTER TABLE hub_settings
  DROP CONSTRAINT IF EXISTS hub_settings_hub_id_fkey;
ALTER TABLE hub_settings
  ADD CONSTRAINT hub_settings_hub_id_fkey
  FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;

-- Swap the primary key. `key` alone was unique across the whole table, which
-- is precisely what stops two hubs having their own value for it.
ALTER TABLE hub_settings DROP CONSTRAINT IF EXISTS hub_settings_pkey;
ALTER TABLE hub_settings ADD PRIMARY KEY (hub_id, key);

-- The read path is always "every setting for one hub" — the request-scoped
-- snapshot loads them in one query — so the hub_id prefix of the primary key
-- already serves it. No second index.

-- Guarded (Phase 2c): these are Supabase's role names; on plain Postgres
-- they do not exist, and the grant is skipped rather than failing the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hub_settings TO authenticated, service_role;
  END IF;
END $$;
