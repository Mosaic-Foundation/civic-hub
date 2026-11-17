-- Districts and demographics, ballots (Adam, 2026-11-16): each ballot carries
-- two coarse tags, so a vote's results can be shown by district and by age
-- group without anyone's answers being read at report time.
--
--   vote_records.district_id   the voter's district (an id from the hub's
--                              about.districts), or NULL: not provided
--   vote_records.age_bracket   18-24, 25-34, 35-49, 50-64, 65-74, 75+, from
--                              the birth year at cast time, or NULL
--   vote_records.race          only when the hub asks about race; NULL
--                              otherwise and when not provided
--
-- Stamped by civic.receipts (src/modules/civic.receipts) when a ballot is
-- cast or changed, from the voter's own About-you answers. The tags name no
-- person and no time: the ballot secrecy rules of 20261010000000 hold (no
-- user, no time, no order; reshuffle_ballots rewrites a process's ballots in
-- random order and now carries the tags with them). Results show a tag's
-- totals only in groups of 5 or more (src/services/breakdowns.ts).
--
-- WHAT THIS GIVES UP (accepted by Adam, 2026-11-17): results never show a
-- group under 5, but someone holding a copy of the hub's database could work
-- out how a person voted if they were the only voter in their district or age
-- group, by comparing these tags with vote_participation and member_about.
-- The Privacy Policy says so.
--
-- cast_ballot_with_tags is cast_ballot with a ninth argument, p_tags (jsonb),
-- under its own name: an overload of cast_ballot would turn /health red
-- (src/db/functionContract.ts) and could leave PostgREST unable to choose.
-- cast_ballot stays, unchanged, for the code running before this release (it
-- leaves the tags NULL); a later migration drops it once nothing calls it.
--
-- Additive: three nullable columns, one new function, reshuffle_ballots
-- replaced with the same signature. Applies twice without error.

-- 1. The tags -----------------------------------------------------------------------
ALTER TABLE vote_records ADD COLUMN IF NOT EXISTS district_id text NULL;
ALTER TABLE vote_records ADD COLUMN IF NOT EXISTS age_bracket text NULL;
ALTER TABLE vote_records ADD COLUMN IF NOT EXISTS race text[] NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vote_records_district_id_check') THEN
    ALTER TABLE vote_records ADD CONSTRAINT vote_records_district_id_check
      CHECK (district_id IS NULL OR district_id ~ '^[a-z0-9][a-z0-9-]{0,59}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vote_records_age_bracket_check') THEN
    ALTER TABLE vote_records ADD CONSTRAINT vote_records_age_bracket_check
      CHECK (age_bracket IS NULL OR age_bracket IN ('18-24', '25-34', '35-49', '50-64', '65-74', '75+'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vote_records_race_check') THEN
    ALTER TABLE vote_records ADD CONSTRAINT vote_records_race_check
      CHECK (race IS NULL OR (cardinality(race) BETWEEN 1 AND 8));
  END IF;
END $$;

COMMENT ON COLUMN vote_records.district_id IS
  'The voter''s district when the ballot was cast or last changed (an id from about.districts), NULL when not provided. Coarse: shown only as totals of 5 or more.';
COMMENT ON COLUMN vote_records.age_bracket IS
  'The voter''s age group at cast time (18-24 … 75+), from their year of birth, NULL when not provided. Never the year.';
COMMENT ON COLUMN vote_records.race IS
  'The voter''s race or ethnicity, only on hubs that ask; NULL otherwise and when not provided.';

COMMENT ON TABLE vote_records IS
  'Anonymous ballots: receipt, process, choice, change-key hash, and coarse tags (district, age group, race only if asked). MUST NOT carry a user identifier, a time, or anything that orders it against vote_participation or events. reshuffle_ballots randomizes physical order. Accepted risk (2026-11-17): results never show a group under 5, but with a copy of the database a voter who is the only one in their district or age group can be worked out from the tags.';

-- 2. Reshuffle carries the tags -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reshuffle_ballots(
  p_hub_id text,
  p_process_id text
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  -- The process lock also waits for any cast_ballot on it in flight.
  PERFORM _civic_lock_process(p_hub_id, p_process_id);

  WITH gone AS (
    DELETE FROM vote_records
     WHERE hub_id = p_hub_id AND process_id = p_process_id
    RETURNING receipt_id, process_id, choice, hub_id, change_key_hash, district_id, age_bracket, race
  )
  INSERT INTO vote_records (receipt_id, process_id, choice, hub_id, change_key_hash, district_id, age_bracket, race)
  SELECT receipt_id, process_id, choice, hub_id, change_key_hash, district_id, age_bracket, race
    FROM gone
   ORDER BY random();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.reshuffle_ballots(text, text) IS
  'Rewrites one process''s ballots in random order (same receipts, choices, key hashes and tags): one shared xmin, no insertion order. Called at close and hourly for open votes. Raises 42501 unless the process is on p_hub_id.';

-- 3. Cast or change a ballot, with its tags ------------------------------------------------
-- The body of 20261011200000's cast_ballot, with the tags written on a first
-- vote and refreshed on a change. p_tags: { district_id, age_bracket, race }.
CREATE OR REPLACE FUNCTION public.cast_ballot_with_tags(
  p_hub_id text,
  p_process_id text,
  p_user_id text,
  p_choice text,
  p_event jsonb,
  p_receipt text,
  p_key_hash text,
  p_new_key_hash text,
  p_tags jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt text;
  v_row_hub text;
  v_voted boolean := false;
  v_current text;
  v_status text;
  v_closes_raw text;
  v_closes timestamptz;
  v_district text := NULLIF(p_tags->>'district_id', '');
  v_age text := NULLIF(p_tags->>'age_bracket', '');
  v_race text[] := CASE
    WHEN jsonb_typeof(p_tags->'race') = 'array' AND jsonb_array_length(p_tags->'race') > 0
      THEN ARRAY(SELECT jsonb_array_elements_text(p_tags->'race'))
    ELSE NULL
  END;
BEGIN
  v_status := _civic_lock_process(p_hub_id, p_process_id);

  -- Open, and before its deadline, checked under the lock a close also takes.
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'vote_not_open' USING ERRCODE = 'P0001';
  END IF;
  SELECT state->>'voting_closes_at' INTO v_closes_raw
    FROM processes WHERE id = p_process_id AND hub_id = p_hub_id;
  IF v_closes_raw IS NOT NULL THEN
    BEGIN
      v_closes := v_closes_raw::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'vote_not_open' USING ERRCODE = 'P0001';
    END;
    IF v_closes <= now() THEN
      RAISE EXCEPTION 'vote_not_open' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  BEGIN
    INSERT INTO vote_participation (user_id, process_id, has_voted, hub_id)
    VALUES (p_user_id, p_process_id, true, p_hub_id);
  EXCEPTION WHEN unique_violation THEN
    v_voted := true;
  END;

  IF NOT v_voted THEN
    IF p_receipt IS NOT NULL THEN
      RAISE EXCEPTION 'receipt_without_vote' USING ERRCODE = 'P0001';
    END IF;
    IF p_new_key_hash IS NULL OR p_new_key_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'a first vote needs a change key hash' USING ERRCODE = '22023';
    END IF;
    v_receipt := gen_random_uuid()::text;
    INSERT INTO vote_records (receipt_id, process_id, choice, hub_id, change_key_hash, district_id, age_bracket, race)
    VALUES (v_receipt, p_process_id, p_choice, p_hub_id, p_new_key_hash, v_district, v_age, v_race);
    UPDATE processes
       SET state = jsonb_set(state, '{total_votes}',
             to_jsonb(coalesce((state->>'total_votes')::integer, 0) + 1))
     WHERE id = p_process_id AND hub_id = p_hub_id;
  ELSE
    SELECT hub_id INTO v_row_hub FROM vote_participation
     WHERE user_id = p_user_id AND process_id = p_process_id;
    IF v_row_hub IS DISTINCT FROM p_hub_id THEN
      RAISE EXCEPTION 'participation row is not on hub %', p_hub_id USING ERRCODE = '42501';
    END IF;
    IF p_receipt IS NULL OR p_key_hash IS NULL THEN
      RAISE EXCEPTION 'already_voted' USING ERRCODE = 'P0001';
    END IF;
    SELECT choice INTO v_current FROM vote_records
     WHERE receipt_id = p_receipt AND process_id = p_process_id AND hub_id = p_hub_id
       AND change_key_hash IS NOT NULL AND change_key_hash = p_key_hash
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'receipt_not_accepted' USING ERRCODE = 'P0001';
    END IF;
    v_receipt := p_receipt;
    IF v_current = p_choice THEN
      -- The same choice again: nothing to write, no event (the tags too stay as they were).
      RETURN jsonb_build_object('receipt_id', v_receipt, 'updated', true, 'unchanged', true);
    END IF;
    UPDATE vote_records SET choice = p_choice, district_id = v_district, age_bracket = v_age, race = v_race
     WHERE receipt_id = p_receipt AND process_id = p_process_id AND hub_id = p_hub_id;
  END IF;

  PERFORM _civic_insert_event(p_hub_id, p_process_id, p_user_id, p_event);

  RETURN jsonb_build_object('receipt_id', v_receipt, 'updated', v_voted, 'unchanged', false);
END;
$$;

COMMENT ON FUNCTION public.cast_ballot_with_tags(text, text, text, text, jsonb, text, text, text, jsonb) IS
  'As cast_ballot (participation, ballot and vote_submitted event in one transaction; a change needs the receipt and change key hash), and stamps the ballot with p_tags { district_id, age_bracket, race } on a first vote and on a change. No row links user and receipt.';

-- 4. Grants, as for cast_ballot (guarded: Supabase role names) -----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.cast_ballot_with_tags(text, text, text, text, jsonb, text, text, text, jsonb) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.cast_ballot_with_tags(text, text, text, text, jsonb, text, text, text, jsonb) TO authenticated, service_role;
  END IF;
END $$;
