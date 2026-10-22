-- events.is_sample is computed by trigger, never accepted from the inserter
-- (Architecture 3, ADR-010; Adam, 2026-10-21, Q5).
--
-- Before this, _civic_event_inherit_sample filled is_sample only when the
-- inserted row did not already claim it, so any insert path could mark a REAL
-- event as sample — and sample events are the one kind the events delete
-- guard lets the hub role delete (20260926040000). Marking a published event
-- as sample was therefore a way to delete it from the public record with no
-- trace. Now the trigger decides alone: an event is a sample exactly when the
-- process it belongs to is, and a supplied value is overwritten.
--
-- Safe on live data: every sample event on every environment checked (594
-- local hubs, all 18 dev hubs) belongs to a sample process, so recomputing
-- changes nothing; existing rows are not rewritten. The hub import is
-- unaffected: it inserts with session_replication_role = replica (triggers
-- off) and re-applies the bundle's own column values.
--
-- Additive: replaces one trigger function in place. CREATE OR REPLACE keeps
-- the function's existing grants (none beyond default; it is called only as
-- a trigger). Never raises; never 40001.

CREATE OR REPLACE FUNCTION public._civic_event_inherit_sample()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.is_sample := NEW.process_id IS NOT NULL AND NEW.process_id <> '' AND EXISTS (
    SELECT 1 FROM processes p
     WHERE p.hub_id = NEW.hub_id AND p.id = NEW.process_id AND p.is_sample
  );
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
