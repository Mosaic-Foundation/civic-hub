-- Who may run each database function: granted by name, never by default.
--
-- Postgres lets PUBLIC execute every new function, and a hosted Supabase
-- project's default privileges also grant EXECUTE to anon, authenticated and
-- service_role by name. Our migrations revoked only PUBLIC, so on hosted dev
-- anon could run tenancy_catalog() (Adam, 2026-10-12), and with the publishable
-- key anyone could call rate_limit_take() or the sign-in counters. The local
-- stack has no such default, which is why CI never saw it.
--
-- This takes EXECUTE on every function in public away from PUBLIC, anon,
-- authenticated and service_role, then grants it back by name:
--
--   authenticated  what the hub calls with a minted hub token (forHub's rpc,
--                  src/db/functionContract.ts) and what those calls reach as
--                  the same role: the helpers SECURITY INVOKER bodies call, and
--                  current_hub_id(), which every hub policy evaluates;
--   service_role   all of that (the hub without minted tokens runs the same
--                  calls), plus the operator and catalog functions;
--   anon           nothing. No policy is written for anon and the hub never
--                  calls as anon.
--
-- Trigger functions get no grant: Postgres checks EXECUTE when a trigger is
-- created, not when it fires. Functions an extension owns are left alone.
--
-- Default privileges: a function the postgres role creates from now on can be
-- run by no one but postgres until a migration grants it, locally and hosted
-- alike. A migration that adds a function grants it by name, as this one does.
-- tests/api/functionGrants.test.ts fails if PUBLIC or anon can run any
-- function in public.
--
-- Changes privileges only; no function, table or row changes. Never raises.

DO $$
DECLARE
  fn regprocedure;
  r text;
  roles text[] := ARRAY(SELECT rolname::text FROM pg_roles
                         WHERE rolname IN ('anon', 'authenticated', 'service_role'));
  hub_fns text[] := ARRAY[
    -- called through forHub(...).rpc()
    'transition_process', 'cast_ballot', 'reshuffle_ballots', 'claim_vote_key',
    'ballot_by_receipt', 'take_code_attempt', 'ai_tokens_since',
    'search_processes', 'search_processes_count',
    -- reached from those, or from a policy or trigger, as the caller
    '_civic_insert_event', '_civic_lock_process', '_civic_search_publishable',
    '_civic_public_search_text', '_civic_json_strings',
    '_civic_end_unverified_sessions', 'current_hub_id'
  ];
  service_fns text[] := ARRAY[
    'function_catalog', 'tenancy_catalog', 'rate_limit_take',
    'take_control_code_attempt', 'take_start_code_attempt',
    -- the pre-2026-10-10 ballot bridge: no code calls it; ballotSecrecy's test
    -- casts through it as the service role. Dropped with the bridge.
    'cast_vote'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    FOREACH r IN ARRAY roles LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', fn, r);
    END LOOP;
  END LOOP;

  FOR fn IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (hub_fns)
  LOOP
    FOREACH r IN ARRAY roles LOOP
      IF r IN ('authenticated', 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn, r);
      END IF;
    END LOOP;
  END LOOP;

  FOR fn IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (service_fns)
  LOOP
    FOREACH r IN ARRAY roles LOOP
      IF r = 'service_role' THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn, r);
      END IF;
    END LOOP;
  END LOOP;

  -- New functions. PUBLIC's EXECUTE is a global default, so it is revoked
  -- globally for the postgres role (it owns every function our migrations
  -- create); the named roles' grants are hosted Supabase's per-schema default.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    FOREACH r IN ARRAY roles LOOP
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', r);
    END LOOP;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
