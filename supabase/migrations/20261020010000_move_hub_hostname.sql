-- A hub's move and its Move activity, in one transaction (Architecture-1, ADR-008).
--
-- A console hostname change used to update hubs.hostname and say nothing on
-- the wire; consumers holding the hub's ids learned of the move only from a
-- redirect. Now the change also writes a `civic.hub.moved` event (AS2 `Move`)
-- and the two happen together or not at all, the pattern of
-- transition_process (atomic state plus event).
--
-- Order matters: the event is inserted BEFORE the hostname changes, so the
-- wire trigger (20261020000000) stamps it with the OLD hostname and the Move
-- is the last activity minted at the old address (Civic Activity Spec §3.3).
--
-- Refuses (P0001 `hub_moved_meanwhile`, never 40001) when the hub's hostname
-- is no longer `p_from`: two console tabs cannot move one hub twice. The
-- caller computes previous_hostnames (movedHostnames in src/control/hubs.ts)
-- and builds the event with buildEvent(), the one emission path.
--
-- Console only: EXECUTE for service_role, nobody else. Additive: one new
-- function. Safe to run twice.

CREATE OR REPLACE FUNCTION public.move_hub_hostname(
  p_hub_id text,
  p_from text,
  p_to text,
  p_previous_hostnames text[],
  p_event jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  current_hostname text;
BEGIN
  SELECT hostname INTO current_hostname FROM hubs WHERE id = p_hub_id FOR UPDATE;
  IF current_hostname IS NULL THEN
    RAISE EXCEPTION 'hub_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF current_hostname IS DISTINCT FROM p_from THEN
    RAISE EXCEPTION 'hub_moved_meanwhile' USING ERRCODE = 'P0001', DETAIL = current_hostname;
  END IF;

  PERFORM public._civic_insert_event(p_hub_id, NULL, NULL, p_event);

  UPDATE hubs
     SET hostname = p_to,
         previous_hostnames = coalesce(p_previous_hostnames, '{}')
   WHERE id = p_hub_id;
END;
$$;

COMMENT ON FUNCTION public.move_hub_hostname(text, text, text, text[], jsonb) IS
  'Console: change a hub''s hostname and write its Move activity in one transaction; the event is stamped with the old hostname (ADR-008).';

REVOKE ALL ON FUNCTION public.move_hub_hostname(text, text, text, text[], jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.move_hub_hostname(text, text, text, text[], jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.move_hub_hostname(text, text, text, text[], jsonb) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.move_hub_hostname(text, text, text, text[], jsonb) TO service_role;
  END IF;
END;
$$;
