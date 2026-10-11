-- Ballot secrecy against the raw data (2026-10-10, Adam approved the
-- non-additive steps in chat; report: Ballot-Secrecy-Session-Report-2026-10-10).
--
-- THE PROMISE: nobody, including Mosaic operators and anyone holding a copy
-- of the database, a backup or an export, can tell how a resident voted.
-- The July audit kept ballots away from the public and from hub admins. A
-- raw copy could still link a voter to a ballot four ways:
--
--   1. The bridge. active_vote_keys (user_id, receipt_id) existed for every
--      ballot of every open vote.
--   2. Time. vote_records.created_at, vote_participation.created_at,
--      active_vote_keys.created_at and events.recorded_at were all now(), the
--      same transaction start, identical to the microsecond.
--   3. Row order. Ballots and participation rows were appended in the same
--      order, and pg_dump writes rows in that order: the n-th voter of a
--      process cast its n-th ballot.
--   4. Transaction id. The ballot and the vote_submitted event (which names
--      the voter) had the same xmin (live database, physical backups).
--
-- WHAT THIS CHANGES
--
--   The voter holds the receipt. A first vote stores, on the ballot, only
--   sha256 of a random change key the voter's browser keeps with the receipt
--   (receipt ids are public in the vote log, so a receipt alone must never
--   change a ballot). To change a vote the browser presents receipt + key.
--   No row links a user to a receipt. cast_ballot replaces cast_vote.
--
--   Ballots carry no time: created_at has no default and must be NULL.
--
--   reshuffle_ballots rewrites one process's ballots in random order (same
--   receipts, choices and key hashes), so they share one xmin and their order
--   says nothing. The vote's close and the hourly vote_close job (at :05, ~12
--   minutes before each 6-hourly backup) call it.
--
--   Early voters: people with a bridge row (voted before this shipped, on a
--   vote still open). claim_vote_key gives their browser a change key for
--   their existing receipt on their next visit and deletes their row.
--   Unclaimed rows go at close, as before. Nothing writes the bridge any
--   more; a later migration drops it and cast_vote once it is empty.
--
-- NON-ADDITIVE, approved by Adam 2026-10-10: every stored ballot's created_at
-- is set to NULL, and every stored vote's ballots are reshuffled once.
-- Copies taken before this (backups, exports) keep the old links until they
-- age out; see the report.
--
-- RLS and hub checks: every function is SECURITY INVOKER, locks and checks
-- the process row's hub first (_civic_lock_process), and touches only rows
-- carrying p_hub_id; the hub policies of 20260925000000 apply inside them.

-- 1. The change key's hash, on the ballot ---------------------------------------
ALTER TABLE vote_records ADD COLUMN IF NOT EXISTS change_key_hash text;
COMMENT ON COLUMN vote_records.change_key_hash IS
  'sha256 (hex) of the change key the voter''s browser holds with the receipt. Presenting both changes the ballot while the vote is open. NULL for sample ballots and ballots from before 2026-10-10 not yet claimed.';

-- 2. No time on a ballot ---------------------------------------------------------
ALTER TABLE vote_records ALTER COLUMN created_at DROP DEFAULT;
ALTER TABLE vote_records ALTER COLUMN created_at DROP NOT NULL;
UPDATE vote_records SET created_at = NULL WHERE created_at IS NOT NULL;
ALTER TABLE vote_records DROP CONSTRAINT IF EXISTS vote_records_no_time;
ALTER TABLE vote_records ADD CONSTRAINT vote_records_no_time CHECK (created_at IS NULL);
COMMENT ON COLUMN vote_records.created_at IS
  'Always NULL (constraint vote_records_no_time). A ballot''s time would match its voter''s participation row and event. Kept only so older bundles and readers find the column; dropped with active_vote_keys.';

COMMENT ON TABLE vote_records IS
  'Anonymous ballots: receipt, process, choice, change-key hash. MUST NOT carry a user identifier, a time, or anything that orders it against vote_participation or events. reshuffle_ballots randomizes physical order.';

COMMENT ON TABLE active_vote_keys IS
  'RETIRED 2026-10-10. Read only by claim_vote_key (early voters collecting a change key) and cleared at close; nothing writes it. Dropped by a later migration once empty.';

-- 3. Reshuffle one process's ballots ------------------------------------------------
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
    RETURNING receipt_id, process_id, choice, hub_id, change_key_hash
  )
  INSERT INTO vote_records (receipt_id, process_id, choice, hub_id, change_key_hash)
  SELECT receipt_id, process_id, choice, hub_id, change_key_hash
    FROM gone
   ORDER BY random();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.reshuffle_ballots(text, text) IS
  'Rewrites one process''s ballots in random order (same receipts, choices, key hashes): one shared xmin, no insertion order. Called at close and hourly for open votes. Raises 42501 unless the process is on p_hub_id.';

-- 4. Cast or change a ballot ---------------------------------------------------------
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
BEGIN
  PERFORM _civic_lock_process(p_hub_id, p_process_id);

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
  'Participation, ballot and vote_submitted event in one transaction; a change needs the voter''s receipt and change key (hash). No row links user and receipt. P0001: already_voted, receipt_not_accepted, receipt_without_vote; 42501 on a hub mismatch.';

-- 5. Early voters collect a change key ------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_vote_key(
  p_hub_id text,
  p_process_id text,
  p_user_id text,
  p_key_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt text;
  v_choice text;
BEGIN
  PERFORM _civic_lock_process(p_hub_id, p_process_id);
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'a change key hash is required' USING ERRCODE = '22023';
  END IF;

  DELETE FROM active_vote_keys
   WHERE user_id = p_user_id AND process_id = p_process_id AND hub_id = p_hub_id
  RETURNING receipt_id INTO v_receipt;
  IF v_receipt IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE vote_records SET change_key_hash = p_key_hash
   WHERE receipt_id = v_receipt AND process_id = p_process_id AND hub_id = p_hub_id
  RETURNING choice INTO v_choice;
  IF v_choice IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('receipt_id', v_receipt, 'choice', v_choice);
END;
$$;

COMMENT ON FUNCTION public.claim_vote_key(text, text, text, text) IS
  'For a voter whose ballot predates 2026-10-10 on a vote still open: sets the ballot''s change-key hash and deletes their bridge row, returning receipt and choice once. NULL when there is no bridge row.';

-- 6. A ballot by its receipt, the receipt in the call body, never a URL --------------------
CREATE OR REPLACE FUNCTION public.ballot_by_receipt(
  p_hub_id text,
  p_process_id text,
  p_receipt text
) RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('receipt_id', receipt_id, 'choice', choice)
    FROM vote_records
   WHERE hub_id = p_hub_id AND process_id = p_process_id AND receipt_id = p_receipt;
$$;

COMMENT ON FUNCTION public.ballot_by_receipt(text, text, text) IS
  'Receipt verification. The receipt travels in the RPC body so no API log records it beside anything else.';

-- 7. Grants, as for cast_vote (guarded: Supabase role names) -------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.reshuffle_ballots(text, text) FROM PUBLIC, anon;
    REVOKE ALL ON FUNCTION public.cast_ballot(text, text, text, text, jsonb, text, text, text) FROM PUBLIC, anon;
    REVOKE ALL ON FUNCTION public.claim_vote_key(text, text, text, text) FROM PUBLIC, anon;
    REVOKE ALL ON FUNCTION public.ballot_by_receipt(text, text, text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.reshuffle_ballots(text, text) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cast_ballot(text, text, text, text, jsonb, text, text, text) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.claim_vote_key(text, text, text, text) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.ballot_by_receipt(text, text, text) TO authenticated, service_role;
  END IF;
END $$;

-- 8. Reshuffle every stored ballot once (approved) ------------------------------------------
-- The whole table in one statement, not per process through
-- reshuffle_ballots: ballots whose process was deleted (no row to lock) are
-- rewritten too. The migration's transaction holds the table.
WITH gone AS (
  DELETE FROM vote_records
  RETURNING receipt_id, process_id, choice, hub_id, change_key_hash
)
INSERT INTO vote_records (receipt_id, process_id, choice, hub_id, change_key_hash)
SELECT receipt_id, process_id, choice, hub_id, change_key_hash
  FROM gone
 ORDER BY random();
