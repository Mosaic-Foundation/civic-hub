-- Phase 2c: two atomic functions, called through forHub().rpc().
--
-- Before this, a lifecycle transition was two calls — UPDATE processes, then
-- INSERT the event — and a vote was four: the vote_submitted event, then the
-- participation row, the ballot and the receipt bridge, held together by
-- hand-written rollbacks in src/modules/civic.receipts. A failure between
-- calls left a status change with no event, an event with no ballot, or a
-- participation row that locked a resident out of a vote they never cast.
-- Each function below does its writes in one transaction: all of them, or
-- none.
--
--   transition_process(p_hub_id, p_process_id, p_to_status, p_actor,
--                      p_event, p_state DEFAULT NULL)
--     The status change (and, when p_state is given, the state written with
--     it — executeAction persists both at once) and its event.
--
--   cast_vote(p_hub_id, p_process_id, p_user_id, p_choice, p_event DEFAULT NULL)
--     Ballot (vote_records), participation (vote_participation), receipt
--     bridge (active_vote_keys) and the vote_submitted event. A re-vote while
--     the bridge exists updates the ballot's choice under the same receipt.
--
-- HUB CHECKS. Every row either function touches carries p_hub_id, or it
-- raises (SQLSTATE 42501) and nothing is written: the process row is checked
-- and locked first; on a re-vote the participation row, the bridge row and
-- the ballot row are checked; every insert is stamped with p_hub_id; an
-- event naming another hub is refused. The composite (hub_id, x_id) keys from
-- Phase 2b stand behind this for the references they cover.
--
-- BALLOT SECRECY — the July 2026 audit's design, unchanged. vote_records has
-- no user_id and vote_participation no receipt_id; active_vote_keys is the one
-- bridge, and only while the vote is open (clearActiveVoteKeysForProcess drops
-- it on close). cast_vote writes exactly those three rows in exactly that
-- shape; it adds no column and no link, and no message it raises names a
-- choice or a receipt. The event is the restricted vote_submitted event the
-- app already emitted (data.vote = { changed }, never the ballot).
--
-- ERRORS the app maps: 'already_voted' (P0001) — a second first-vote with no
-- bridge left, the pre-existing refusal; 42501 — a hub mismatch; P0002 — no
-- such process.
--
-- Additive: two new functions and two internal helpers; nothing existing is
-- changed. SECURITY INVOKER (the default), so under Phase 3's forced RLS they
-- run with the caller's hub claim and the policies apply inside them too.

-- The event row, from the JSON the app builds (src/events/eventStore.ts,
-- eventToRow), stamped with the hub. A helper of the two functions below; the
-- app never calls it directly.
CREATE OR REPLACE FUNCTION public._civic_insert_event(
  p_hub_id text,
  p_process_id text,
  p_actor text,
  p_event jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_event IS NULL THEN
    RETURN;
  END IF;
  IF p_event ? 'hub_id' AND p_event->>'hub_id' IS DISTINCT FROM p_hub_id THEN
    RAISE EXCEPTION 'event names hub %, not %', p_event->>'hub_id', p_hub_id
      USING ERRCODE = '42501';
  END IF;
  IF p_event->>'process_id' IS DISTINCT FROM p_process_id THEN
    RAISE EXCEPTION 'event is for process %, not %', p_event->>'process_id', p_process_id
      USING ERRCODE = '22023';
  END IF;
  IF p_actor IS NOT NULL AND p_event->>'actor' IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'event actor does not match the caller''s actor'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO events (
    id, version, event_type, process_id, actor, jurisdiction, action_url,
    source, dedupe_key, data, meta, created_at, hub_id
  ) VALUES (
    p_event->>'id',
    coalesce(p_event->>'version', '1.0'),
    p_event->>'event_type',
    p_event->>'process_id',
    p_event->>'actor',
    p_event->>'jurisdiction',
    p_event->>'action_url',
    p_event->'source',
    p_event->>'dedupe_key',
    coalesce(p_event->'data', '{}'::jsonb),
    p_event->'meta',
    coalesce((p_event->>'created_at')::timestamptz, now()),
    p_hub_id
  );
END;
$$;

-- The process row, locked for the rest of the transaction, and its hub
-- checked. Internal.
CREATE OR REPLACE FUNCTION public._civic_lock_process(
  p_hub_id text,
  p_process_id text
) RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hub text;
  v_status text;
BEGIN
  SELECT hub_id, status INTO v_hub, v_status
    FROM processes WHERE id = p_process_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no process %', p_process_id USING ERRCODE = 'P0002';
  END IF;
  IF v_hub IS DISTINCT FROM p_hub_id THEN
    RAISE EXCEPTION 'process % is not on hub %', p_process_id, p_hub_id
      USING ERRCODE = '42501';
  END IF;
  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_process(
  p_hub_id text,
  p_process_id text,
  p_to_status text,
  p_actor text,
  p_event jsonb,
  p_state jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from text;
  v_now timestamptz := now();
BEGIN
  v_from := _civic_lock_process(p_hub_id, p_process_id);

  UPDATE processes
     SET status = p_to_status,
         state = coalesce(p_state, state),
         updated_at = v_now
   WHERE id = p_process_id AND hub_id = p_hub_id;

  PERFORM _civic_insert_event(p_hub_id, p_process_id, p_actor, p_event);

  RETURN jsonb_build_object('previous_status', v_from, 'status', p_to_status, 'updated_at', v_now);
END;
$$;

COMMENT ON FUNCTION public.transition_process(text, text, text, text, jsonb, jsonb) IS
  'A process status change (with its state, when given) and its event, in one transaction. Raises 42501 unless the process is on p_hub_id.';

CREATE OR REPLACE FUNCTION public.cast_vote(
  p_hub_id text,
  p_process_id text,
  p_user_id text,
  p_choice text,
  p_event jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt text;
  v_row_hub text;
  v_updated boolean := false;
  v_count integer;
BEGIN
  PERFORM _civic_lock_process(p_hub_id, p_process_id);

  BEGIN
    INSERT INTO vote_participation (user_id, process_id, has_voted, hub_id)
    VALUES (p_user_id, p_process_id, true, p_hub_id);
  EXCEPTION WHEN unique_violation THEN
    v_updated := true;
  END;

  IF v_updated THEN
    -- A re-vote. The participation row that stopped the insert must be this
    -- hub's (it always is — a process has one hub — but the check is the rule).
    SELECT hub_id INTO v_row_hub FROM vote_participation
     WHERE user_id = p_user_id AND process_id = p_process_id;
    IF v_row_hub IS DISTINCT FROM p_hub_id THEN
      RAISE EXCEPTION 'participation row is not on hub %', p_hub_id USING ERRCODE = '42501';
    END IF;

    SELECT receipt_id, hub_id INTO v_receipt, v_row_hub FROM active_vote_keys
     WHERE user_id = p_user_id AND process_id = p_process_id;
    IF NOT FOUND THEN
      -- The bridge is gone (the vote closed) or never existed (a ballot from
      -- before receipts): the change is refused, as it always was.
      RAISE EXCEPTION 'already_voted' USING ERRCODE = 'P0001';
    END IF;
    IF v_row_hub IS DISTINCT FROM p_hub_id THEN
      RAISE EXCEPTION 'receipt bridge is not on hub %', p_hub_id USING ERRCODE = '42501';
    END IF;

    UPDATE vote_records SET choice = p_choice
     WHERE receipt_id = v_receipt AND hub_id = p_hub_id AND process_id = p_process_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'ballot for this receipt is not on hub %', p_hub_id USING ERRCODE = '42501';
    END IF;
  ELSE
    v_receipt := gen_random_uuid()::text;
    INSERT INTO vote_records (receipt_id, process_id, choice, hub_id)
    VALUES (v_receipt, p_process_id, p_choice, p_hub_id);
    INSERT INTO active_vote_keys (user_id, process_id, receipt_id, hub_id)
    VALUES (p_user_id, p_process_id, v_receipt, p_hub_id);
  END IF;

  PERFORM _civic_insert_event(p_hub_id, p_process_id, p_user_id, p_event);

  RETURN jsonb_build_object('receipt_id', v_receipt, 'updated', v_updated);
END;
$$;

COMMENT ON FUNCTION public.cast_vote(text, text, text, text, jsonb) IS
  'Ballot, participation, receipt bridge and vote_submitted event in one transaction, preserving the ballot-secrecy layout. Raises 42501 unless every row touched is on p_hub_id; P0001 already_voted when a re-vote has no bridge.';

-- The helpers are the two functions' own: taken from PUBLIC, and granted
-- below only to the roles that call the functions, because a SECURITY INVOKER
-- function runs its helpers with its caller's privileges. Under Phase 3's
-- forced RLS an insert through either still has to satisfy the caller's hub
-- policy.
REVOKE ALL ON FUNCTION public._civic_insert_event(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_lock_process(text, text) FROM PUBLIC;

-- Guarded: Supabase's role names; skipped on plain Postgres.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.transition_process(text, text, text, text, jsonb, jsonb) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cast_vote(text, text, text, text, jsonb) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public._civic_insert_event(text, text, text, jsonb) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public._civic_lock_process(text, text) TO authenticated, service_role;
  END IF;
END $$;
