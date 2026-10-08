-- Evaluators' own submissions on a demo hub (2026-10-07, session 3b; review
-- R25; Adam: "marked and removed").
--
-- On a demo hub a non-admin's submission is stored as sample content
-- (`is_sample`, so its events stay out of /events and federation and may be
-- deleted by the hub app) and ALSO `added_in_demo`, which says a visitor wrote
-- it rather than the seed. The hub shows no Sample badge on it; "Remove sample
-- content" (and graduating out of demo) takes it with the samples, counted
-- separately first. The scheduled sample refresh never touches it.
--
-- Additive: one column with a default, one partial index, and the spawn
-- trigger re-created to carry the new mark as it already carries is_sample
-- (a vote spawned from a visitor's proposal is a visitor's too).

ALTER TABLE processes ADD COLUMN IF NOT EXISTS added_in_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN processes.added_in_demo IS
  'Written by a visitor on a demo hub (always with is_sample). No Sample badge; removed with the sample content.';

CREATE INDEX IF NOT EXISTS processes_hub_added_in_demo_idx ON processes (hub_id) WHERE added_in_demo;

CREATE OR REPLACE FUNCTION public._civic_process_inherit_sample()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sources text[];
BEGIN
  IF NEW.is_sample THEN
    RETURN NEW;
  END IF;
  v_sources := array_remove(ARRAY[
    NEW.source_proposal_id,
    NEW.state->>'source_process_id',
    NEW.state->>'source_proposal_id'
  ], NULL);
  IF array_length(v_sources, 1) IS NOT NULL THEN
    SELECT bool_or(p.is_sample), bool_or(p.added_in_demo)
      INTO NEW.is_sample, NEW.added_in_demo
      FROM processes p
     WHERE p.hub_id = NEW.hub_id AND p.id = ANY (v_sources);
    NEW.is_sample := coalesce(NEW.is_sample, false);
    NEW.added_in_demo := coalesce(NEW.added_in_demo, false) AND NEW.is_sample;
  END IF;
  RETURN NEW;
END;
$$;

-- review_turns: append-only, except a sample process's ----------------------
--
-- A visitor's submission goes through the review funnel, so it has a review
-- and its turns. review_turns refused every UPDATE and DELETE (the shared
-- prevent_modification()), so sample content with a review could never be
-- removed. The same rule events already follow (_civic_events_delete_guard):
-- the turns of a review whose process is sample content may be deleted; every
-- other turn stays append-only, and UPDATE stays refused for all. Removal
-- deletes the turns explicitly while their review still exists (a cascade
-- from the review would find no parent to check, and is refused).

CREATE OR REPLACE FUNCTION public._civic_review_turns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1
      FROM process_reviews r
      JOIN processes p ON p.hub_id = r.hub_id AND p.id = r.process_id
     WHERE r.hub_id = OLD.hub_id AND r.id = OLD.review_id AND p.is_sample
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Table % is append-only; UPDATE/DELETE not permitted', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS review_turns_no_mutation ON review_turns;
CREATE TRIGGER review_turns_no_mutation
  BEFORE UPDATE OR DELETE ON review_turns
  FOR EACH ROW EXECUTE FUNCTION public._civic_review_turns_guard();
