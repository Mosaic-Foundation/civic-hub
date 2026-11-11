-- The console's own schema and database role (the console split, step 3a;
-- Console-Split-Step-3-Plan-2026-11-10.md). Adam approves this migration:
-- it MOVES seven tables, though no row is copied, changed or lost.
--
-- The console's seven tables leave `public` for a `console` schema:
--   control_sessions, control_audit_log, platform_sign_in_codes,
--   entitlements, entitlement_links, entitlement_redemptions, start_sessions.
-- ALTER TABLE … SET SCHEMA moves each with its rows, indexes, constraints,
-- triggers (the audit log's append-only one) and grants. The foreign keys
-- among them move too; none points at a hub table.
--
-- A stand-in view keeps each old name in `public` (security_invoker, granted
-- to service_role only, like the tables), so the code running when this
-- applies, and the console until it connects as civic_console (step 3b),
-- read and write exactly as before. A later migration drops the stand-ins.
--
-- civic_console: the console's own login (created NOLOGIN here; Adam sets
-- its password per project, which also lets it log in). It may use the
-- `console` schema and nothing else: no grant on any hub table, so the
-- database refuses a console query against hub data.

CREATE SCHEMA IF NOT EXISTS console;
COMMENT ON SCHEMA console IS
  'The console''s own data (the console split, 2026-11-10): operator sessions and audit, sign-in codes, invite codes, start-page sessions. Not hub data. Reached by the civic_console role (and service_role during the move).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'civic_console') THEN
    CREATE ROLE civic_console NOLOGIN NOINHERIT;
  END IF;
END
$$;
COMMENT ON ROLE civic_console IS
  'The console''s database login (the console split). Rights on schema console only.';

-- Move the tables (idempotent: each only if it is still in public).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'control_sessions', 'control_audit_log', 'platform_sign_in_codes',
    'entitlements', 'entitlement_links', 'entitlement_redemptions', 'start_sessions'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA console', t);
    END IF;
  END LOOP;
END
$$;

-- The append-only trigger's function stays in public; it reads no table.
-- The platform sign-in function follows its table.
CREATE OR REPLACE FUNCTION console.take_platform_sign_in_attempt(
  p_realm text,
  p_purpose text,
  p_email text,
  p_link_hash text,
  p_max integer
) RETURNS TABLE (id text, email text, code_hash text, link_hash text, attempts integer, expires_at timestamptz)
LANGUAGE sql
SET search_path = console, pg_temp
AS $$
  UPDATE console.platform_sign_in_codes c
     SET attempts = c.attempts + 1
   WHERE c.realm = p_realm
     AND c.purpose = p_purpose
     AND ((p_email IS NOT NULL AND c.email = p_email)
       OR (p_link_hash IS NOT NULL AND c.link_hash = p_link_hash))
     AND c.attempts < p_max
     AND c.expires_at > now()
  RETURNING c.id, c.email, c.code_hash, c.link_hash, c.attempts, c.expires_at;
$$;

-- The public one now reads the moved table (by its full name), so the
-- console's current code keeps working through PostgREST.
CREATE OR REPLACE FUNCTION public.take_platform_sign_in_attempt(
  p_realm text,
  p_purpose text,
  p_email text,
  p_link_hash text,
  p_max integer
) RETURNS TABLE (id text, email text, code_hash text, link_hash text, attempts integer, expires_at timestamptz)
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  SELECT * FROM console.take_platform_sign_in_attempt(p_realm, p_purpose, p_email, p_link_hash, p_max);
$$;

-- The console's own rate limits (step 3b uses them): the same rules as the
-- hubs' rate_limit_take(), on its own table.
CREATE TABLE IF NOT EXISTS console.rate_limit_hits (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket  text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS console_rate_limit_hits_bucket_at ON console.rate_limit_hits (bucket, at DESC);
COMMENT ON TABLE console.rate_limit_hits IS
  'The console''s and the start page''s rate-limited attempts, by hashed bucket (as public.rate_limit_hits is the hubs''). Pruned after two days.';

-- Stand-ins under the old names, for the code of the moment.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'control_sessions', 'control_audit_log', 'platform_sign_in_codes',
    'entitlements', 'entitlement_links', 'entitlement_redemptions', 'start_sessions'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = t) THEN
      EXECUTE format('CREATE VIEW public.%I WITH (security_invoker = true) AS SELECT * FROM console.%I', t, t);
      EXECUTE format('COMMENT ON VIEW public.%I IS %L', t,
        'Stand-in for console.' || t || ' while the console moves to its own role (the console split, step 3). Dropped in step 3b.');
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    END IF;
  END LOOP;
END
$$;

-- Grants. Only service_role on the stand-ins (as on the tables before), and
-- the same on the moved tables, which a security_invoker view needs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA console FROM anon, authenticated;
    REVOKE ALL ON public.control_sessions, public.control_audit_log, public.platform_sign_in_codes,
      public.entitlements, public.entitlement_links, public.entitlement_redemptions, public.start_sessions
      FROM anon, authenticated;
    GRANT USAGE ON SCHEMA console TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON console.control_sessions, console.platform_sign_in_codes,
      console.entitlements, console.entitlement_links, console.entitlement_redemptions, console.start_sessions
      TO service_role;
    GRANT SELECT, INSERT ON console.control_audit_log TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.control_sessions, public.platform_sign_in_codes,
      public.entitlements, public.entitlement_links, public.entitlement_redemptions, public.start_sessions
      TO service_role;
    GRANT SELECT, INSERT ON public.control_audit_log TO service_role;
    GRANT EXECUTE ON FUNCTION console.take_platform_sign_in_attempt(text, text, text, text, integer) TO service_role;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA console TO civic_console;
GRANT SELECT, INSERT, UPDATE, DELETE ON console.control_sessions, console.platform_sign_in_codes,
  console.entitlements, console.entitlement_links, console.entitlement_redemptions, console.start_sessions,
  console.rate_limit_hits
  TO civic_console;
GRANT SELECT, INSERT ON console.control_audit_log TO civic_console;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA console TO civic_console;
GRANT EXECUTE ON FUNCTION console.take_platform_sign_in_attempt(text, text, text, text, integer) TO civic_console;
REVOKE ALL ON SCHEMA public FROM civic_console;

-- Row security: the moved tables keep forced RLS with no policy for anon and
-- authenticated (deny-all); civic_console gets one policy each to see all of
-- its own data. service_role bypasses RLS, as before.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'control_sessions', 'control_audit_log', 'platform_sign_in_codes',
    'entitlements', 'entitlement_links', 'entitlement_redemptions', 'start_sessions', 'rate_limit_hits'
  ] LOOP
    EXECUTE format('ALTER TABLE console.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE console.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'console' AND c.relname = t AND p.polname = 'console_own') THEN
      EXECUTE format('CREATE POLICY console_own ON console.%I TO civic_console USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
