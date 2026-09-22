-- Grant table privileges explicitly, so a local stack matches the hosted one.
--
-- Every migration before this one creates tables without a single GRANT. That
-- works on the hosted project only because its default privileges hand the
-- Supabase roles full DML on anything created in `public`. A local
-- `supabase start` does not: tables created by the `postgres` role get the
-- roles only TRUNCATE/REFERENCES/TRIGGER, so the service-role client is denied
-- on every table and the app cannot boot at all — which is exactly what
-- happened the first time this was tried (Phase 0 finding, see
-- BUILD-PLAN-multi-tenant.md → "Findings that change what Phase 2 and Phase 3
-- must do").
--
-- On the hosted project this migration is a no-op in effect: it grants what
-- the default privileges already granted. Locally it is the difference
-- between a working stack and a broken one.
--
-- This does NOT widen access. RLS is enabled on every table with no
-- permissive policies, so `authenticated` still reads nothing; a GRANT is
-- permission to attempt a query, and the policy decides the rows. Granting
-- `authenticated` now is what lets Phase 3 turn on policies without also
-- having to hand out privileges at the same time.
--
-- From here on, every migration that creates a table ends with its own
-- explicit GRANT rather than relying on this backfill.

do $$
declare
  t record;
  s record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated, service_role',
      t.tablename
    );
  end loop;

  -- Sequences behind any `serial` / identity column: inserting needs USAGE.
  for s in
    select sequencename from pg_sequences where schemaname = 'public'
  loop
    execute format(
      'grant usage, select on sequence public.%I to authenticated, service_role',
      s.sequencename
    );
  end loop;
end $$;
