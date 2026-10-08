-- A hub that moves keeps its old address working (review R47, 2026-10-08).
--
-- Moving a demo hub from `x-demo.civic.social` to `x.civic.social` at
-- handover used to break every link already shared: the old hostname matched
-- no hub and served "no hub here". Now the console records the address a hub
-- leaves, and the resolver (src/middleware/hub.ts) answers a request for it
-- with a redirect to the hub's current address, path and query kept.
--
-- A column on the registry rather than a table of its own: these are the
-- hub's own addresses, read by the same service-role resolver as `hostname`,
-- and the tenancy catalog's list of tables without hub_id stays as it is.
--
-- `redirect_to` (20260924040000) is a different thing and stays: where a hub
-- that has LEFT this deployment now lives. The resolver now reads it too.
--
-- Additive: a new column with a constant default, an index, and a backfill
-- from the console's audit log of the moves made before this column existed.

ALTER TABLE hubs ADD COLUMN IF NOT EXISTS previous_hostnames TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS hubs_previous_hostnames_idx ON hubs USING GIN (previous_hostnames);

COMMENT ON COLUMN hubs.previous_hostnames IS
  'Addresses this hub has moved from. A request for one redirects to hostname. Written by the console on a hostname change; each stays taken.';

-- Every earlier move the console recorded: hub.update rows whose `before`
-- holds the old hostname. An address that is some hub's current hostname
-- again is left out (it serves that hub, not a redirect).
UPDATE hubs h
SET previous_hostnames = moved.hosts
FROM (
  SELECT l.target_hub_id AS hub_id, array_agg(DISTINCT l.before->>'hostname') AS hosts
  FROM control_audit_log l
  WHERE l.action = 'hub.update'
    AND l.before ? 'hostname'
    AND l.target_hub_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM hubs cur WHERE cur.hostname = l.before->>'hostname')
  GROUP BY l.target_hub_id
) AS moved
WHERE h.id = moved.hub_id
  AND h.previous_hostnames = '{}';
