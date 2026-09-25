-- Search is scoped to one hub (Phase 2a, from the exit-rights audit).
--
-- search_processes and search_processes_count read `processes` with no hub
-- filter, so every hub's search returned every hub's processes: the one
-- database function that would leak across hubs even after every module
-- goes through forHub().
--
-- New signatures take p_hub_id FIRST and REQUIRED (no default), and filter on
-- it. forHub().rpc() passes p_hub_id on every call, so src/services/
-- searchExecutor.ts reaches only these. Because p_hub_id has no default,
-- PostgREST never confuses the two overloads: a call that names p_hub_id can
-- only be the new one, a call that does not can only be the old one.
--
-- The old signatures stay until cutover, DEPRECATED, as thin wrappers that
-- call the new ones for the migration-default hub ('floyd', as the hub_id
-- column defaults do). That keeps a deployment still running the old code —
-- production, until the cutover — answering exactly as before, since every
-- row it has is Floyd's. The cleanup migration drops them.

CREATE OR REPLACE FUNCTION public.search_processes(
  p_hub_id text,
  p_q text,
  p_types text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_sort text DEFAULT 'relevance',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(id text, type text, title text, description text, status text, state jsonb, created_at timestamptz, rank real)
LANGUAGE sql
STABLE
AS $function$
  WITH q AS (
    SELECT websearch_to_tsquery('english', p_q) AS query
  )
  SELECT
    p.id,
    p.type,
    p.title,
    p.description,
    p.status::text,
    p.state,
    p.created_at,
    ts_rank(p.search_doc, q.query) AS rank
  FROM processes p, q
  WHERE
    p.hub_id = p_hub_id
    AND p.search_doc @@ q.query
    AND p.status IN ('active', 'closed', 'finalized')
    AND (
      p.state -> 'moderation' ->> 'removed' IS NULL
      OR p.state -> 'moderation' ->> 'removed' = 'false'
    )
    AND (p_types IS NULL OR p.type = ANY(p_types))
    AND (p_from IS NULL OR p.created_at >= p_from)
    AND (p_to   IS NULL OR p.created_at <= p_to)
  ORDER BY
    CASE WHEN p_sort = 'newest' THEN NULL ELSE ts_rank(p.search_doc, q.query) END DESC NULLS LAST,
    CASE WHEN p_sort = 'newest' THEN p.created_at ELSE NULL END DESC NULLS LAST,
    p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$function$;

CREATE OR REPLACE FUNCTION public.search_processes_count(
  p_hub_id text,
  p_q text,
  p_types text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
AS $function$
  WITH q AS (
    SELECT websearch_to_tsquery('english', p_q) AS query
  )
  SELECT count(*)::bigint
  FROM processes p, q
  WHERE
    p.hub_id = p_hub_id
    AND p.search_doc @@ q.query
    AND p.status IN ('active', 'closed', 'finalized')
    AND (
      p.state -> 'moderation' ->> 'removed' IS NULL
      OR p.state -> 'moderation' ->> 'removed' = 'false'
    )
    AND (p_types IS NULL OR p.type = ANY(p_types))
    AND (p_from IS NULL OR p.created_at >= p_from)
    AND (p_to   IS NULL OR p.created_at <= p_to);
$function$;

-- DEPRECATED: the unscoped signatures, now wrappers for the migration-default
-- hub. Dropped by the cleanup migration after cutover.
CREATE OR REPLACE FUNCTION public.search_processes(
  p_q text,
  p_types text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_sort text DEFAULT 'relevance',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(id text, type text, title text, description text, status text, state jsonb, created_at timestamptz, rank real)
LANGUAGE sql
STABLE
AS $function$
  SELECT * FROM public.search_processes('floyd', p_q, p_types, p_from, p_to, p_sort, p_limit, p_offset);
$function$;

CREATE OR REPLACE FUNCTION public.search_processes_count(
  p_q text,
  p_types text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
AS $function$
  SELECT public.search_processes_count('floyd', p_q, p_types, p_from, p_to);
$function$;

COMMENT ON FUNCTION public.search_processes(text, text[], timestamptz, timestamptz, text, integer, integer) IS
  'DEPRECATED: unscoped; searches the migration-default hub. Use search_processes(p_hub_id, ...). Dropped after cutover.';
COMMENT ON FUNCTION public.search_processes_count(text, text[], timestamptz, timestamptz) IS
  'DEPRECATED: unscoped; counts the migration-default hub. Use search_processes_count(p_hub_id, ...). Dropped after cutover.';

-- Guarded (Phase 2c): these are Supabase's role names; on plain Postgres
-- they do not exist, and the grant is skipped rather than failing the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.search_processes(text, text, text[], timestamptz, timestamptz, text, integer, integer)
      TO authenticated, service_role;
  END IF;
END $$;
-- Guarded (Phase 2c): these are Supabase's role names; on plain Postgres
-- they do not exist, and the grant is skipped rather than failing the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.search_processes_count(text, text, text[], timestamptz, timestamptz)
      TO authenticated, service_role;
  END IF;
END $$;
