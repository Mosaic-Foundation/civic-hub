-- Phase 3, step 4: the tenancy catalog, one row per table in public.
--
-- What tests/api/rlsCatalog.test.ts reads to prove that every table carries
-- hub_id, has row-level security enabled AND forced, has exactly the
-- hub_isolation policy from the one template (20260925000000), and has an
-- index that leads with hub_id. PostgREST does not expose pg_catalog, so the
-- test asks this function instead of the catalog directly. An operator can
-- call it too (as the service role) to check a database before switching
-- minted tokens on — e.g. at cutover, against production.
--
-- It also reports the post-images storage policies (Phase 2c), which the
-- 2c migration only warns about when a host refuses them.
--
-- Read-only, SECURITY INVOKER; executable by the service role only — the
-- schema's shape is nobody else's business.

CREATE OR REPLACE FUNCTION public.tenancy_catalog()
RETURNS TABLE (
  table_name text,
  has_hub_id boolean,
  rls_enabled boolean,
  rls_forced boolean,
  hub_leading_index boolean,
  policies jsonb
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    c.relname::text,
    EXISTS (
      SELECT 1 FROM pg_attribute a
       WHERE a.attrelid = c.oid AND a.attname = 'hub_id' AND NOT a.attisdropped
    ),
    c.relrowsecurity,
    c.relforcerowsecurity,
    EXISTS (
      SELECT 1 FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE i.indrelid = c.oid AND a.attname = 'hub_id'
    ),
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'name', p.polname,
               'cmd', p.polcmd,
               'permissive', p.polpermissive,
               'roles', (SELECT jsonb_agg(r.rolname ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)),
               'using', pg_get_expr(p.polqual, p.polrelid),
               'with_check', pg_get_expr(p.polwithcheck, p.polrelid)
             ) ORDER BY p.polname)
        FROM pg_policy p WHERE p.polrelid = c.oid
    ), '[]'::jsonb)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')

  UNION ALL

  -- The storage policies on storage.objects that key on current_hub_id().
  SELECT
    'storage.objects'::text,
    false,
    c.relrowsecurity,
    c.relforcerowsecurity,
    false,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'name', p.polname,
               'cmd', p.polcmd,
               'permissive', p.polpermissive,
               'roles', (SELECT jsonb_agg(r.rolname ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)),
               'using', pg_get_expr(p.polqual, p.polrelid),
               'with_check', pg_get_expr(p.polwithcheck, p.polrelid)
             ) ORDER BY p.polname)
        FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname LIKE 'post_images_hub_%'
    ), '[]'::jsonb)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage' AND c.relname = 'objects'

  ORDER BY 1
$$;

COMMENT ON FUNCTION public.tenancy_catalog() IS
  'One row per public table: hub_id, RLS enabled/forced, hub-leading index, policies. Read by tests/api/rlsCatalog.test.ts; service role only.';

REVOKE ALL ON FUNCTION public.tenancy_catalog() FROM PUBLIC;

-- Guarded: Supabase's role names; skipped on plain Postgres.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.tenancy_catalog() TO service_role;
  END IF;
END $$;
