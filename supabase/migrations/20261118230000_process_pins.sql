-- Pinning phase 2 (Adam, 2026-11-18): pins are the hub's own, not part of the
-- item they pin. Pinning is a hub core feature, admins only, for any item;
-- no plugin writes pin code.
--
--   process_pins   one row per item pinned to the Pinned card: who pinned it,
--                  when, and its optional end date. Unpinning deletes the row.
--                  An end date that has passed reads as unpinned (nothing has
--                  to run). Deleted with its item (the foreign key cascades).
--
-- Until now a pin was four flat fields in the item's state (`pinned`,
-- `pinned_at`, `pinned_by`, `pinned_until`; announcements since 2026-11-15,
-- any item since 2026-11-18). Each item pinned now is copied here. The fields
-- are left in the state, unread: removing them would rewrite rows for no
-- reader, and a later cleanup can drop them.
--
-- Additive: one new table, forced RLS by the hub template, like every hub
-- table, and a copy. Applies twice without error (the copy skips a pin that
-- is already here).

CREATE TABLE IF NOT EXISTS process_pins (
  hub_id        text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  process_id    text NOT NULL,
  pinned_by     text NULL,
  pinned_at     timestamptz NOT NULL DEFAULT now(),
  pinned_until  timestamptz NULL,
  PRIMARY KEY (hub_id, process_id),
  CONSTRAINT process_pins_process_fkey FOREIGN KEY (hub_id, process_id) REFERENCES processes (hub_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE process_pins IS
  'Items an admin pinned to the hub''s Pinned card (any type), with who pinned each, when, and an optional end date. Unpinning deletes the row; a passed end date reads as unpinned.';
COMMENT ON COLUMN process_pins.pinned_by IS
  'The admin who pinned it (a users.id on this hub), or NULL when not known (pins copied from before 2026-11-18 without one).';

SELECT public._civic_apply_hub_policy('public.process_pins');

DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('authenticated', 'service_role') LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.process_pins TO %I', r);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.process_pins FROM anon;
  END IF;
END $$;

-- The pins stored in items' state, copied. A date that does not parse is left
-- out (the item reads as unpinned, as it did).
INSERT INTO process_pins (hub_id, process_id, pinned_by, pinned_at, pinned_until)
SELECT p.hub_id,
       p.id,
       NULLIF(p.state->>'pinned_by', ''),
       CASE WHEN (p.state->>'pinned_at') ~ '^\d{4}-\d{2}-\d{2}' THEN (p.state->>'pinned_at')::timestamptz ELSE p.created_at END,
       CASE WHEN (p.state->>'pinned_until') ~ '^\d{4}-\d{2}-\d{2}' THEN (p.state->>'pinned_until')::timestamptz ELSE NULL END
  FROM processes p
 WHERE p.state->>'pinned' = 'true'
   AND ((p.state->>'pinned_until') IS NULL OR (p.state->>'pinned_until') ~ '^\d{4}-\d{2}-\d{2}')
ON CONFLICT (hub_id, process_id) DO NOTHING;
