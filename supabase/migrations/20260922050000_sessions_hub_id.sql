-- Sessions belong to a hub.
--
-- A session token is a bearer credential: whoever holds it is that person.
-- Without a hub on the row, a token minted by signing in to one hub would
-- authenticate its holder on every other hub served by the same deployment —
-- and with one deployment now serving many hubs, that is a resident of a demo
-- hub holding a valid credential for a real jurisdiction's.
--
-- That is the first tenancy boundary that matters, which is why sessions get
-- `hub_id` here rather than waiting for Phase 2 to add it to all thirty
-- tables. The rest are data; this one is identity.
--
-- Additive and safe against a live database: add with a default, backfill,
-- constrain. Every existing session was minted on Floyd, the only hub that
-- has ever existed. The default is dropped in Phase 2 once every writer
-- passes a hub explicitly.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS hub_id TEXT NOT NULL DEFAULT 'floyd';

UPDATE sessions SET hub_id = 'floyd' WHERE hub_id IS NULL OR hub_id = '';

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_hub_id_fkey;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_hub_id_fkey
  FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE;

-- Every lookup is "this token, on this hub", so the index carries both. The
-- token alone is already the primary key; this one exists so the hub filter
-- is satisfied from the index rather than by fetching the row and checking.
CREATE INDEX IF NOT EXISTS sessions_token_hub_idx ON sessions (token, hub_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO authenticated, service_role;

COMMENT ON COLUMN sessions.hub_id IS
  'The hub this session was created on. A session is valid only on its own hub.';
