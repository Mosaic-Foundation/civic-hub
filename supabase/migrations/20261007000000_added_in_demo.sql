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
-- Additive: two columns with defaults, one partial index, the spawn trigger
-- re-created to carry the new mark as it already carries is_sample (a vote
-- spawned from a visitor's proposal is a visitor's too), a guard that the
-- markers are never turned on after insert, and review_turns' guard replaced
-- by one that lets only sample turns be deleted (Adam's three conditions,
-- 2026-10-07).

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

-- The marker is set at insert, never later ---------------------------------
--
-- What may be deleted is decided by the marker (below, and the events guard),
-- so the marker must never be turned on for a row that was real: an UPDATE
-- that sets is_sample or added_in_demo on a process that did not have it is
-- refused, for every role. They are set only at insert (the sample seed, a
-- visitor's submission on a demo hub) or by the database's own stamping
-- (_civic_process_inherit_sample). Turning a marker OFF stays allowed.

CREATE OR REPLACE FUNCTION public._civic_processes_marker_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.is_sample AND NOT OLD.is_sample) OR (NEW.added_in_demo AND NOT OLD.added_in_demo) THEN
    RAISE EXCEPTION 'processes.is_sample and processes.added_in_demo are set only when a process is created'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS processes_marker_guard ON processes;
CREATE TRIGGER processes_marker_guard
  BEFORE UPDATE OF is_sample, added_in_demo ON processes
  FOR EACH ROW EXECUTE FUNCTION public._civic_processes_marker_guard();

-- review_turns: append-only, except a sample process's ----------------------
--
-- A visitor's submission goes through the review funnel, so it has a review
-- and its turns. review_turns refused every UPDATE and DELETE (the shared
-- prevent_modification()), so sample content with a review could never be
-- removed. Now the same rule as events (_civic_events_delete_guard), decided
-- by the row's OWN marker:
--
--   - review_turns.is_sample is stamped by the database at insert from the
--     review's process, whatever the client sent (a client cannot insert a
--     deletable turn on a real review);
--   - DELETE is allowed only when OLD.is_sample; every other turn stays
--     append-only, for every role;
--   - UPDATE is refused for all, so the marker can never be turned on later.
--
-- Restore and purge, which suspend triggers, are unchanged. No backfill: no
-- sample process had a review before this migration (the seed writes none,
-- and visitors' submissions are marked from this release on).

ALTER TABLE review_turns ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN review_turns.is_sample IS
  'Set by trigger at insert from the review''s process. Only sample turns may be deleted; none may be updated.';

CREATE OR REPLACE FUNCTION public._civic_review_turn_inherit_sample()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.is_sample := EXISTS (
    SELECT 1
      FROM process_reviews r
      JOIN processes p ON p.hub_id = r.hub_id AND p.id = r.process_id
     WHERE r.hub_id = NEW.hub_id AND r.id = NEW.review_id AND p.is_sample
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS review_turns_inherit_sample ON review_turns;
CREATE TRIGGER review_turns_inherit_sample
  BEFORE INSERT ON review_turns
  FOR EACH ROW EXECUTE FUNCTION public._civic_review_turn_inherit_sample();

CREATE OR REPLACE FUNCTION public._civic_review_turns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_sample THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Table % is append-only; UPDATE/DELETE not permitted', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS review_turns_no_mutation ON review_turns;
CREATE TRIGGER review_turns_no_mutation
  BEFORE UPDATE OR DELETE ON review_turns
  FOR EACH ROW EXECUTE FUNCTION public._civic_review_turns_guard();
