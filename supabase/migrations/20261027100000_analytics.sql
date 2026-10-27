-- Analytics: the participation record (2026-10-27, ADR-016).
--
-- The hub counts participation from the event log alone, in counts that never
-- identify anyone. Every type is counted from its manifest's `participation`
-- declaration (src/shared/participation.ts), which the app turns into a
-- "plan" (event type, process type, role) and hands to the functions below:
-- nothing here names a process type.
--
--   analytics_daily    per hub, local day, process type and event type: how
--                      many events. Filled by the job from event_counts_by_day.
--   analytics_period   per hub and calendar period (week, month, quarter,
--                      since launch): the counts of distinct residents, which
--                      cannot be added up from days. Filled by the job from
--                      event_actor_counts.
--
-- The two functions are reads of the event log any feature may make (the
-- SDK's eventLog()); the tables are the analytics feature's own.
--   analytics_report_keys   keys a hub admin issues to a named outside
--                      organisation; only a hash is kept.
--   analytics_report_reads  every read made with a key; append-only.
--
-- NO PER-PERSON SERIES. event_actor_counts builds its sets of accounts
-- inside one statement and returns counts only; no table here holds an
-- account id except the issuing and revoking admin of a key. Ballots are
-- never read: a vote's participation is its vote_submitted event (which names
-- the voter, never the choice); vote_records, active_vote_keys and
-- vote_participation are not touched.
--
-- Additive: four new tables, two read functions and a trigger function. Nothing existing changes.
-- SECURITY INVOKER (the default): under forced RLS the hub's own policy
-- applies inside the functions; each also filters on p_hub_id for the
-- service-role mode.

-- 1. The daily rollup ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics_daily (
  hub_id        text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  day           date NOT NULL,
  process_type  text NOT NULL,
  event_type    text NOT NULL,
  events        integer NOT NULL CHECK (events >= 0),
  PRIMARY KEY (hub_id, day, process_type, event_type)
);
COMMENT ON TABLE analytics_daily IS
  'Events per hub, local day (the hub''s time zone), process type and event type (ADR-016). Derived from events (event_counts_by_day) by the analytics job; recomputed, never exported.';
SELECT public._civic_apply_hub_policy('public.analytics_daily');

-- 2. The period counts -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics_period (
  hub_id        text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  period_kind   text NOT NULL CHECK (period_kind IN ('week', 'month', 'quarter', 'all')),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  measure       text NOT NULL,
  value         integer NOT NULL CHECK (value >= 0),
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, period_kind, period_start, measure)
);
COMMENT ON TABLE analytics_period IS
  'Counts of distinct residents per hub and calendar period (ADR-016): active, by type, across types, returning, new, and the funder measures. Counts only; recomputed by the analytics job, never exported.';
SELECT public._civic_apply_hub_policy('public.analytics_period');

-- 3. Reporting keys and their reads ----------------------------------------------

CREATE TABLE IF NOT EXISTS analytics_report_keys (
  hub_id        text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  id            text NOT NULL,
  organisation  text NOT NULL CHECK (length(btrim(organisation)) BETWEEN 1 AND 200),
  contact       text NOT NULL CHECK (length(btrim(contact)) BETWEEN 1 AND 200),
  purpose       text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 1000),
  key_hash      text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  key_hint      text NOT NULL CHECK (length(key_hint) = 4),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NULL,
  revoked_at    timestamptz NULL,
  revoked_by    text NULL,
  PRIMARY KEY (hub_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS analytics_report_keys_hash_idx ON analytics_report_keys (hub_id, key_hash);
COMMENT ON TABLE analytics_report_keys IS
  'Reporting keys a hub admin issued to named outside organisations (ADR-016). sha256 of the key only; the key is shown once. A revoked key reads nothing.';
COMMENT ON COLUMN analytics_report_keys.key_hint IS 'The key''s last four characters, so an admin can tell keys apart.';
SELECT public._civic_apply_hub_policy('public.analytics_report_keys');

CREATE TABLE IF NOT EXISTS analytics_report_reads (
  hub_id        text NOT NULL REFERENCES hubs(id) ON DELETE RESTRICT,
  id            text NOT NULL DEFAULT gen_random_uuid()::text,
  key_id        text NOT NULL,
  organisation  text NOT NULL,
  read_at       timestamptz NOT NULL DEFAULT now(),
  period_kind   text NOT NULL,
  period_start  date NOT NULL,
  PRIMARY KEY (hub_id, id)
);
CREATE INDEX IF NOT EXISTS analytics_report_reads_hub_at_idx ON analytics_report_reads (hub_id, read_at DESC);
COMMENT ON TABLE analytics_report_reads IS
  'Every read of /analytics made with a reporting key: which organisation, when, which period (ADR-016). Append-only (trigger); the hub admin sees it on the Activity page.';

CREATE OR REPLACE FUNCTION public._analytics_report_reads_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'analytics_report_reads is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS analytics_report_reads_append_only ON analytics_report_reads;
CREATE TRIGGER analytics_report_reads_append_only
  BEFORE UPDATE OR DELETE ON analytics_report_reads
  FOR EACH ROW EXECUTE FUNCTION public._analytics_report_reads_append_only();
SELECT public._civic_apply_hub_policy('public.analytics_report_reads');

-- 4. Events per day (a read of the event log) -----------------------------------

-- One hub's events on the local days p_from..p_to (in p_tz), samples left
-- out, counted by day, process type (the process's, or the type the event was
-- stamped with) and event type. A read: the analytics job writes what it
-- returns into analytics_daily. Counts only.
CREATE OR REPLACE FUNCTION public.event_counts_by_day(p_hub_id text, p_tz text, p_from date, p_to date)
RETURNS TABLE (day date, process_type text, event_type text, events integer)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (e.created_at AT TIME ZONE p_tz)::date,
         coalesce(p.type, e.data->'process'->>'type', ''),
         e.event_type,
         count(*)::integer
    FROM events e
    LEFT JOIN processes p ON p.hub_id = e.hub_id AND p.id = e.process_id
   WHERE e.hub_id = p_hub_id
     AND NOT e.is_sample
     AND e.created_at >= (p_from::timestamp AT TIME ZONE p_tz)
     AND e.created_at < ((p_to + 1)::timestamp AT TIME ZONE p_tz)
   GROUP BY 1, 2, 3
   ORDER BY 1, 2, 3
$$;
COMMENT ON FUNCTION public.event_counts_by_day(text, text, date, date) IS
  'One hub''s events per local day, process type and event type, samples left out (ADR-016). Counts only.';

-- 5. The period counts -----------------------------------------------------------

-- Counts of distinct residents for one hub over the local dates
-- p_from..p_to (and, for "returning", p_prev_from..p_prev_to). A resident is
-- an account of this hub that is not a sample; the system and other actors are
-- not residents. p_plan, from the manifests (src/features/analytics/plan.ts):
--
--   acts      [{t, e}]  the events that make a resident active (participation
--                       and creation; t = process type, or "*" for the host's
--                       own events on any type)
--   measures  {id: [{t, e}]}  the events behind each resident measure
--   sources   [{id, t, e, f}] an outcome event of type t (e) whose payload
--                       field f names the process it summarizes: measure id
--                       counts the residents with an act on that source before
--                       the outcome
--   totals    [{t, e, f, n, of}] a total (payload field n) that an event of
--                       type t (e) records for the process field f names, when
--                       that process's type is in `of`
--
-- Returns (measure, value) rows:
--   active, active:<type>, multi_type, returning, new_residents,
--   measure:<id>, source:<id>, total:<type>
--
-- Every set of accounts lives inside this one statement; only counts leave it.
CREATE OR REPLACE FUNCTION public.event_actor_counts(
  p_hub_id text, p_tz text, p_from date, p_to date, p_prev_from date, p_prev_to date, p_plan jsonb
)
RETURNS TABLE (measure text, value integer)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH b AS (
    SELECT p_from::timestamp AT TIME ZONE p_tz AS lo,
           (p_to + 1)::timestamp AT TIME ZONE p_tz AS hi,
           p_prev_from::timestamp AT TIME ZONE p_tz AS plo,
           (p_prev_to + 1)::timestamp AT TIME ZONE p_tz AS phi
  ),
  acts AS (SELECT t, e FROM jsonb_to_recordset(coalesce(p_plan->'acts', '[]'::jsonb)) AS x(t text, e text)),
  ev AS (
    SELECT e.actor, e.event_type, e.created_at, coalesce(p.type, e.data->'process'->>'type', '') AS ptype
      FROM events e
      JOIN users u ON u.hub_id = e.hub_id AND u.id = e.actor AND NOT u.is_sample
      LEFT JOIN processes p ON p.hub_id = e.hub_id AND p.id = e.process_id
      CROSS JOIN b
     WHERE e.hub_id = p_hub_id
       AND NOT e.is_sample
       AND ((e.created_at >= b.lo AND e.created_at < b.hi)
            OR (b.plo IS NOT NULL AND e.created_at >= b.plo AND e.created_at < b.phi))
  ),
  cur AS (
    SELECT DISTINCT ev.actor, ev.ptype
      FROM ev JOIN acts a ON a.e = ev.event_type AND (a.t = '*' OR a.t = ev.ptype) CROSS JOIN b
     WHERE ev.created_at >= b.lo AND ev.created_at < b.hi
  ),
  prev AS (
    SELECT DISTINCT ev.actor
      FROM ev JOIN acts a ON a.e = ev.event_type AND (a.t = '*' OR a.t = ev.ptype) CROSS JOIN b
     WHERE b.plo IS NOT NULL AND ev.created_at >= b.plo AND ev.created_at < b.phi
  ),
  mpairs AS (
    SELECT m.key AS id, x.t, x.e
      FROM jsonb_each(coalesce(p_plan->'measures', '{}'::jsonb)) AS m
      CROSS JOIN LATERAL jsonb_to_recordset(m.value) AS x(t text, e text)
  ),
  srcs AS (SELECT id, t, e, f FROM jsonb_to_recordset(coalesce(p_plan->'sources', '[]'::jsonb)) AS x(id text, t text, e text, f text)),
  outcomes AS (
    SELECT s.id, o.data->>s.f AS source_id, o.created_at
      FROM events o
      JOIN processes op ON op.hub_id = o.hub_id AND op.id = o.process_id
      JOIN srcs s ON s.e = o.event_type AND s.t = op.type
      CROSS JOIN b
     WHERE o.hub_id = p_hub_id AND NOT o.is_sample
       AND o.created_at >= b.lo AND o.created_at < b.hi
  ),
  behind AS (
    SELECT DISTINCT oc.id, e.actor
      FROM outcomes oc
      JOIN events e ON e.hub_id = p_hub_id AND e.process_id = oc.source_id AND e.created_at <= oc.created_at AND NOT e.is_sample
      JOIN users u ON u.hub_id = e.hub_id AND u.id = e.actor AND NOT u.is_sample
      JOIN processes sp ON sp.hub_id = e.hub_id AND sp.id = e.process_id
      JOIN acts a ON a.e = e.event_type AND (a.t = '*' OR a.t = sp.type)
  ),
  tots AS (SELECT t, e, f, n, "of" FROM jsonb_to_recordset(coalesce(p_plan->'totals', '[]'::jsonb)) AS x(t text, e text, f text, n text, "of" text[])),
  totals AS (
    SELECT sp.type AS source_type,
           sum(CASE WHEN jsonb_typeof(r.data->x.n) = 'number' THEN (r.data->>x.n)::numeric ELSE 0 END) AS total
      FROM events r
      JOIN processes rp ON rp.hub_id = r.hub_id AND rp.id = r.process_id
      JOIN tots x ON x.e = r.event_type AND x.t = rp.type
      JOIN processes sp ON sp.hub_id = r.hub_id AND sp.id = r.data->>x.f AND sp.type = ANY (x."of")
      CROSS JOIN b
     WHERE r.hub_id = p_hub_id AND NOT r.is_sample
       AND r.created_at >= b.lo AND r.created_at < b.hi
     GROUP BY sp.type
  )
  SELECT 'active', count(DISTINCT actor)::integer FROM cur
  UNION ALL
  SELECT 'active:' || ptype, count(DISTINCT actor)::integer FROM cur GROUP BY ptype
  UNION ALL
  SELECT 'multi_type', count(*)::integer FROM (SELECT actor FROM cur GROUP BY actor HAVING count(DISTINCT ptype) > 1) m
  UNION ALL
  SELECT 'returning', count(*)::integer FROM (SELECT DISTINCT actor FROM cur) c WHERE p_prev_from IS NOT NULL AND c.actor IN (SELECT actor FROM prev)
  UNION ALL
  SELECT 'new_residents', count(*)::integer
    FROM users u CROSS JOIN b
   WHERE u.hub_id = p_hub_id AND u.is_resident AND NOT u.is_sample AND u.created_at >= b.lo AND u.created_at < b.hi
  UNION ALL
  SELECT 'measure:' || mp.id, count(DISTINCT ev.actor)::integer
    FROM (SELECT DISTINCT id FROM mpairs) mi
    JOIN mpairs mp ON mp.id = mi.id
    LEFT JOIN ev ON ev.event_type = mp.e AND (mp.t = '*' OR mp.t = ev.ptype)
                AND ev.created_at >= (SELECT lo FROM b) AND ev.created_at < (SELECT hi FROM b)
   GROUP BY mp.id
  UNION ALL
  SELECT 'source:' || s.id, (SELECT count(DISTINCT bh.actor)::integer FROM behind bh WHERE bh.id = s.id)
    FROM (SELECT DISTINCT id FROM srcs) s
  UNION ALL
  SELECT 'total:' || source_type, round(total)::integer FROM totals
$$;
COMMENT ON FUNCTION public.event_actor_counts(text, text, date, date, date, date, jsonb) IS
  'Counts of distinct residents for one hub and period, from the events the plan names (ADR-016). Counts only: no account id leaves the statement. Reads events, users and processes; never ballots.';

-- 6. Grants ----------------------------------------------------------------------
-- The hub reads and writes its rollups and keys under its token; the read log
-- takes inserts and reads only (the trigger refuses the rest). anon gets nothing.
DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('authenticated', 'service_role') LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_daily, analytics_period, analytics_report_keys TO %I', r);
    EXECUTE format('GRANT SELECT, INSERT ON analytics_report_reads TO %I', r);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.event_counts_by_day(text, text, date, date) TO %I', r);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.event_actor_counts(text, text, date, date, date, date, jsonb) TO %I', r);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON analytics_daily, analytics_period, analytics_report_keys, analytics_report_reads FROM anon;
    REVOKE ALL ON FUNCTION public.event_counts_by_day(text, text, date, date) FROM anon;
    REVOKE ALL ON FUNCTION public.event_actor_counts(text, text, date, date, date, date, jsonb) FROM anon;
    REVOKE ALL ON FUNCTION public._analytics_report_reads_append_only() FROM anon;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.event_counts_by_day(text, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_actor_counts(text, text, date, date, date, date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._analytics_report_reads_append_only() FROM PUBLIC;
