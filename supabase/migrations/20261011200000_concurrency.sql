-- Audit 3, part one: two people (or two page loads) acting at the same moment
-- cannot produce a wrong result (audit A7). Adam approved the non-additive
-- items in chat (2026-10-11).
--
-- 1. processes.version (additive). A counter every UPDATE of a process row
--    bumps, by trigger, whoever writes it: executeAction, saveProcessState, a
--    handler's own update, cast_ballot. A write that read version N and finds
--    N+1 knows someone else wrote in between, and is refused instead of
--    overwriting them (the lost update).
--
--    processes.close_claimed_until (additive): a deadline close is claimed by
--    one reader with a conditional update; the others leave it to that one, so
--    an expensive close (a conversation's summary) runs once, not once per
--    page load. The claim lapses after two minutes, so a failed close is tried
--    again.
--
-- 2. transition_process, replaced (same name, a compatible signature: the
--    new arguments are defaulted, so a caller from before this migration still
--    works during the deploy window). It is now the one write an action makes:
--      p_expected_status  refuse unless the row still has this status;
--      p_expected_version refuse unless the row still has this version;
--      p_events           the events the action emitted about this process,
--                         written in the same transaction, in order (the app
--                         holds them while the handler runs; see
--                         src/services/actionScope.ts).
--    A refusal is P0001 'process_changed' and writes nothing: the events of a
--    losing close never reach the log. (Not 40001: PostgREST retries a
--    transaction that fails with serialization_failure, so a stale version
--    would be retried by it for ever. The app decides whether to retry.)
--
-- 3. cast_ballot, replaced (same signature; the ballot secrecy design of
--    20261010000000 is unchanged: receipts held by the voter, no ballot time,
--    the change key hash, the bridge untouched). Under the process row lock it
--    now refuses a ballot unless the vote is active and before its deadline
--    (P0001 'vote_not_open'), and a first vote adds one to
--    state.total_votes there, so the count is not a read-modify-write in the
--    app. The process row was already written right after every ballot; now it
--    is written inside the same transaction instead of just after it.
--
-- 4. One brief per source process (additive): a unique partial index. The
--    spawn inserts and, on a conflict, skips. Dev (production-shaped) had no
--    duplicates on 2026-10-11; check production with the query in the Audit 3
--    report before applying.
--
-- 5. DROP TABLE start_attempts (non-additive, approved): retired by Audit 2,
--    read by nothing.

-- 1. processes.version -------------------------------------------------------------

ALTER TABLE processes ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN processes.version IS
  'Bumped by trigger on every UPDATE. A write that read version N is refused once it is not N (transition_process p_expected_version; saveProcessState). Not data: left out of hub exports.';

ALTER TABLE processes ADD COLUMN IF NOT EXISTS close_claimed_until timestamptz;

COMMENT ON COLUMN processes.close_claimed_until IS
  'A reader claimed this process''s deadline close until then (processService.closeAtDeadline); others leave it alone. Not data: left out of hub exports.';

CREATE OR REPLACE FUNCTION public._civic_bump_process_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS processes_version ON processes;
CREATE TRIGGER processes_version
  BEFORE UPDATE ON processes
  FOR EACH ROW EXECUTE FUNCTION public._civic_bump_process_version();

-- 2. transition_process -------------------------------------------------------------

DROP FUNCTION IF EXISTS public.transition_process(text, text, text, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.transition_process(
  p_hub_id text,
  p_process_id text,
  p_to_status text,
  p_actor text,
  p_event jsonb,
  p_state jsonb DEFAULT NULL,
  p_expected_status text DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL,
  p_events jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from text;
  v_version bigint;
  v_now timestamptz := now();
  v_event jsonb;
BEGIN
  v_from := _civic_lock_process(p_hub_id, p_process_id);

  IF p_expected_status IS NOT NULL AND v_from IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'process_changed'
      USING ERRCODE = 'P0001', DETAIL = format('status is %s, expected %s', v_from, p_expected_status);
  END IF;
  IF p_expected_version IS NOT NULL THEN
    SELECT version INTO v_version FROM processes WHERE id = p_process_id AND hub_id = p_hub_id;
    IF v_version IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'process_changed'
        USING ERRCODE = 'P0001', DETAIL = format('version is %s, expected %s', v_version, p_expected_version);
    END IF;
  END IF;

  UPDATE processes
     SET status = p_to_status,
         state = coalesce(p_state, state),
         updated_at = v_now
   WHERE id = p_process_id AND hub_id = p_hub_id
   RETURNING version INTO v_version;

  -- The action's own events, in the order it emitted them. Each names this
  -- process (checked by the helper); their actors are the handler's, so the
  -- caller's actor is not imposed on them.
  IF p_events IS NOT NULL THEN
    IF jsonb_typeof(p_events) <> 'array' THEN
      RAISE EXCEPTION 'p_events must be an array' USING ERRCODE = '22023';
    END IF;
    FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
      PERFORM _civic_insert_event(p_hub_id, p_process_id, NULL, v_event);
    END LOOP;
  END IF;

  PERFORM _civic_insert_event(p_hub_id, p_process_id, p_actor, p_event);

  RETURN jsonb_build_object(
    'previous_status', v_from,
    'status', p_to_status,
    'updated_at', v_now,
    'version', v_version
  );
END;
$$;

COMMENT ON FUNCTION public.transition_process(text, text, text, text, jsonb, jsonb, text, bigint, jsonb) IS
  'A process''s status and state, the events of the action that changed them, and its status event, in one transaction. Refuses (P0001 process_changed) when p_expected_status or p_expected_version no longer holds. Raises 42501 unless the process is on p_hub_id.';

-- 3. cast_ballot ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cast_ballot(
  p_hub_id text,
  p_process_id text,
  p_user_id text,
  p_choice text,
  p_event jsonb,
  p_receipt text,
  p_key_hash text,
  p_new_key_hash text
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
BEGIN
  v_status := _civic_lock_process(p_hub_id, p_process_id);

  -- Open, and before its deadline, checked under the lock a close also takes:
  -- a ballot either lands before the close (and the close, refused on its
  -- version, counts it) or is refused. A deadline that cannot be read refuses
  -- rather than leaving the vote open for ever.
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
    -- A first vote. A receipt presented by someone who has not voted here is
    -- not theirs (another account's, on a shared browser): refused, and the
    -- participation row above goes with the transaction.
    IF p_receipt IS NOT NULL THEN
      RAISE EXCEPTION 'receipt_without_vote' USING ERRCODE = 'P0001';
    END IF;
    IF p_new_key_hash IS NULL OR p_new_key_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'a first vote needs a change key hash' USING ERRCODE = '22023';
    END IF;
    v_receipt := gen_random_uuid()::text;
    INSERT INTO vote_records (receipt_id, process_id, choice, hub_id, change_key_hash)
    VALUES (v_receipt, p_process_id, p_choice, p_hub_id, p_new_key_hash);
    -- The count of voters, under the lock (not read, added to and written
    -- back by the app, where two voters at once lost one).
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
    -- A change needs the receipt and its key. Without them: the old refusal.
    IF p_receipt IS NULL OR p_key_hash IS NULL THEN
      RAISE EXCEPTION 'already_voted' USING ERRCODE = 'P0001';
    END IF;
    SELECT choice INTO v_current FROM vote_records
     WHERE receipt_id = p_receipt AND process_id = p_process_id AND hub_id = p_hub_id
       AND change_key_hash IS NOT NULL AND change_key_hash = p_key_hash
       FOR UPDATE;
    IF NOT FOUND THEN
      -- Wrong receipt, wrong key, another process's or hub's ballot: one
      -- answer for all, naming neither receipt nor choice.
      RAISE EXCEPTION 'receipt_not_accepted' USING ERRCODE = 'P0001';
    END IF;
    v_receipt := p_receipt;
    IF v_current = p_choice THEN
      -- The same choice again: nothing to write, no event.
      RETURN jsonb_build_object('receipt_id', v_receipt, 'updated', true, 'unchanged', true);
    END IF;
    UPDATE vote_records SET choice = p_choice
     WHERE receipt_id = p_receipt AND process_id = p_process_id AND hub_id = p_hub_id;
  END IF;

  PERFORM _civic_insert_event(p_hub_id, p_process_id, p_user_id, p_event);

  RETURN jsonb_build_object('receipt_id', v_receipt, 'updated', v_voted, 'unchanged', false);
END;
$$;

COMMENT ON FUNCTION public.cast_ballot(text, text, text, text, jsonb, text, text, text) IS
  'Participation, ballot and vote_submitted event in one transaction, only while the vote is active and before its deadline; a first vote adds one to state.total_votes. A change needs the voter''s receipt and change key (hash). No row links user and receipt. P0001: vote_not_open, already_voted, receipt_not_accepted, receipt_without_vote; 42501 on a hub mismatch.';

-- 4. One brief per source process ----------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS processes_one_brief_per_source
  ON processes (hub_id, (state->>'source_process_id'))
  WHERE type = 'civic.brief';

-- 5. start_attempts, retired by Audit 2 --------------------------------------------

DROP TABLE IF EXISTS start_attempts;

-- Grants (guarded: Supabase role names). transition_process was dropped and
-- recreated, so its grant is given again; cast_ballot keeps its own.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.transition_process(text, text, text, text, jsonb, jsonb, text, bigint, jsonb) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.transition_process(text, text, text, text, jsonb, jsonb, text, bigint, jsonb) TO authenticated, service_role;
  END IF;
END $$;
