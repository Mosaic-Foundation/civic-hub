-- The protocol identity becomes a property of each hub.
--
-- Three identifiers, three jobs, never derived from each other at runtime
-- (decided with Adam, 2026-09-24; recorded in BUILD-PLAN-multi-tenant.md):
--
--   hubs.id               the tenant key, stamped into every table's hub_id
--   hubs.protocol_hub_id  `source.hub_id` on every event the hub publishes
--   hubs.space_did        the space's DID, generator.id on activities
--
-- Until now the protocol id was one env var for the whole deployment
-- (CIVIC_HUB_ID, `HUB_ID` in src/config/hub.ts), and a per-row copy of it sat
-- in processes.hub_id. Phase 2 needs that column for the tenant, so the
-- protocol id moves here, where it can differ per hub.
--
-- Floyd keeps 'civic-hub-local', the identity every event it has already
-- published carries, so nothing it has said changes provenance. Any other
-- existing hub gets 'civic-hub-<slug>', which is also what
-- scripts/create-hub.ts writes for a new one. After this, HUB_ID is only the
-- fallback for code with no hub in scope.

ALTER TABLE hubs ADD COLUMN IF NOT EXISTS protocol_hub_id TEXT;

UPDATE hubs SET protocol_hub_id = 'civic-hub-local'
 WHERE id = 'floyd' AND protocol_hub_id IS NULL;
UPDATE hubs SET protocol_hub_id = 'civic-hub-' || id
 WHERE protocol_hub_id IS NULL;

ALTER TABLE hubs ALTER COLUMN protocol_hub_id SET NOT NULL;

-- Two hubs publishing under one identity would be indistinguishable to
-- anyone reading their events.
ALTER TABLE hubs DROP CONSTRAINT IF EXISTS hubs_protocol_hub_id_key;
ALTER TABLE hubs ADD CONSTRAINT hubs_protocol_hub_id_key UNIQUE (protocol_hub_id);

-- Guarded (Phase 2c): these are Supabase's role names; on plain Postgres
-- they do not exist, and the grant is skipped rather than failing the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hubs TO authenticated, service_role;
  END IF;
END $$;

COMMENT ON COLUMN hubs.protocol_hub_id IS
  'source.hub_id on events this hub publishes. Not hubs.id, not space_did.';
