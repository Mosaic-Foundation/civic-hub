-- Exit rights: where a hub's data lives, and where it went (Phase 2a).
--
-- Two columns on the registry that nothing reads yet (Adam, 2026-09-24,
-- after the exit-rights audit). They exist now so that moving a hub out of
-- the shared database later is a change of data, not of schema:
--
--   db_ref       which database holds this hub's rows. 'shared' is the one
--                multi-tenant database every hub lives in today. A hub moved
--                to its own database (an enterprise deployment, a self-host)
--                gets another value; the resolver will route on it then.
--   redirect_to  where this hub's hostname now lives, once it has left this
--                deployment. Null while it is served here.
--
-- Additive: a constant default is a catalog change, and every existing hub
-- is in the shared database.

ALTER TABLE hubs ADD COLUMN IF NOT EXISTS db_ref TEXT NOT NULL DEFAULT 'shared';
ALTER TABLE hubs ADD COLUMN IF NOT EXISTS redirect_to TEXT NULL;

-- Guarded (Phase 2c): these are Supabase's role names; on plain Postgres
-- they do not exist, and the grant is skipped rather than failing the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hubs TO authenticated, service_role;
  END IF;
END $$;

COMMENT ON COLUMN hubs.db_ref IS
  'Database holding this hub''s rows. ''shared'' = the multi-tenant database. Not read yet.';
COMMENT ON COLUMN hubs.redirect_to IS
  'Where this hub''s hostname lives after leaving this deployment; null while served here. Not read yet.';
