-- The roles the migrations grant to and PostgREST switches into, on a plain
-- Postgres (docs/RUN-ANYWHERE.md, ADR-012). A Supabase project has them
-- already; run this once, as the database owner, before the migrations.
--
--   anon           a request with no token (PostgREST's anonymous role)
--   authenticated  a request under a minted hub token (forced RLS live)
--   service_role   the server's own key: bypasses RLS, as on Supabase
--   authenticator  the role PostgREST logs in as and switches from
--
-- And, as on Supabase, extensions live in their own `extensions` schema, so
-- pgcrypto's functions are not callable by every role through PostgREST
-- (tests/api/functionGrants.test.ts holds the public schema to an allow list).
-- The first migration's CREATE EXTENSION then finds it already there.
--
-- Idempotent. The password is the one argument PostgREST's connection string
-- carries; set your own (psql -v authenticator_password=…).

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
END
$$;

ALTER ROLE authenticator WITH PASSWORD :'authenticator_password';
GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SELECT format('ALTER DATABASE %I SET search_path = "$user", public, extensions', current_database()) \gexec
