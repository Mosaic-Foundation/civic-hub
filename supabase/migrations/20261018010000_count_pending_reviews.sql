-- The admin Reviews count, counted in the database (the cleanup slice).
--
-- GET /admin/queue-counts read every pending review row that changed since
-- the admin last opened the tab and counted them in the server, which hit
-- PostgREST's 1,000-row cap (CIVIC_ROW_CAP) on a long-used hub. This counts
-- them here instead, leaving out reviews of a switched-off type's processes
-- as the server did.
--
-- SECURITY INVOKER, like the other hub functions: under a minted hub token
-- the hub policies apply as well as the p_hub_id filter. Granted to
-- authenticated and service_role by name (20261012100000's rule); listed in
-- src/db/functionContract.ts and tests/api/functionGrants.test.ts.
--
-- Additive. Never raises.

CREATE OR REPLACE FUNCTION public.count_pending_reviews(
  p_hub_id text,
  p_since timestamptz,
  p_excluded_types text[] DEFAULT '{}'
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::bigint
    FROM process_reviews r
   WHERE r.hub_id = p_hub_id
     AND r.status = 'pending_review'
     AND r.updated_at > p_since
     AND NOT EXISTS (
       SELECT 1 FROM processes p
        WHERE p.hub_id = r.hub_id
          AND p.id = r.process_id
          AND p.type = ANY (coalesce(p_excluded_types, '{}'))
     );
$$;

COMMENT ON FUNCTION public.count_pending_reviews(text, timestamptz, text[]) IS
  'Pending reviews changed since p_since, leaving out reviews of processes whose type is in p_excluded_types. The admin Reviews tab''s count.';

REVOKE ALL ON FUNCTION public.count_pending_reviews(text, timestamptz, text[]) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.count_pending_reviews(text, timestamptz, text[]) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.count_pending_reviews(text, timestamptz, text[]) TO authenticated, service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
