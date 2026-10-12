-- Audit 4: the database functions the code calls, as the catalog has them.
--
-- GET /health already checks tables and columns (src/db/schemaContract.ts).
-- On 2026-10-11 dev ran Audit 3's code against a database that still had the
-- old transition_process, and /health said "ok" while every vote approval
-- failed. src/db/functionContract.ts lists every function the code calls with
-- its argument signature; /health compares it with what this returns and
-- reports a missing or mismatched function as a gap (503).
--
-- PostgREST does not expose pg_catalog, so the check asks this function.
-- Additive. Read-only, SECURITY INVOKER, executable by the service role only.
-- Never raises.

CREATE OR REPLACE FUNCTION public.function_catalog(p_names text[])
RETURNS TABLE (name text, identity_args text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p.proname::text, pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = ANY (p_names)
   ORDER BY 1, 2;
$$;

COMMENT ON FUNCTION public.function_catalog(text[]) IS
  'Name and identity arguments of each public function named in p_names (every overload). Read by GET /health against src/db/functionContract.ts; service role only.';

REVOKE ALL ON FUNCTION public.function_catalog(text[]) FROM PUBLIC;

-- Guarded: Supabase's role names; skipped on plain Postgres. Revoked from anon
-- and authenticated by name too, in case a project's default privileges grant
-- new functions to them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.function_catalog(text[]) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.function_catalog(text[]) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.function_catalog(text[]) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
