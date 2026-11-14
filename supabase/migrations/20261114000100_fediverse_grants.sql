-- The fediverse feature's table grants, which 20261114000000_fediverse.sql
-- left out (CI: "permission denied for table fediverse_followers" under the
-- hub token and the service role). The hub reads and writes both tables under
-- its token, as every hub table; anon gets nothing. Additive.

DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('authenticated', 'service_role') LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.fediverse_keys, public.fediverse_followers TO %I', r);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.fediverse_keys, public.fediverse_followers FROM anon;
  END IF;
END $$;
