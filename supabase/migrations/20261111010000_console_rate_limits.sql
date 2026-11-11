-- The console's own rate limits (the console split, step 3b). ADDITIVE.
--
-- The console and the start page count their sign-in steps in
-- console.rate_limit_hits (20261111000000), through these copies of the
-- hubs' rate_limit_take() and rate_limit_retry_at() (20261011100000,
-- 20261014000000): the same rules, the console's own table, so civic_console
-- never touches the hubs' counters.

CREATE OR REPLACE FUNCTION console.rate_limit_take(
  p_buckets text[],
  p_limits integer[],
  p_window_seconds integer[]
) RETURNS integer
LANGUAGE plpgsql
SET search_path = console, pg_temp
AS $$
DECLARE
  n integer := coalesce(array_length(p_buckets, 1), 0);
  b text;
  i integer;
  used integer;
BEGIN
  IF n = 0
     OR coalesce(array_length(p_limits, 1), 0) <> n
     OR coalesce(array_length(p_window_seconds, 1), 0) <> n THEN
    RAISE EXCEPTION 'rate_limit_take: buckets, limits and windows must be non-empty and the same length'
      USING ERRCODE = '22023';
  END IF;

  -- One lock per bucket, in sorted order (no deadlock between two calls).
  FOR b IN SELECT DISTINCT x FROM unnest(p_buckets) AS x ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('civic.console_rate_limit:' || b, 0));
  END LOOP;

  FOR i IN 1..n LOOP
    SELECT count(*) INTO used
      FROM console.rate_limit_hits
     WHERE bucket = p_buckets[i]
       AND at > now() - make_interval(secs => p_window_seconds[i]);
    IF used >= p_limits[i] THEN
      RETURN i; -- refused, and not counted
    END IF;
  END LOOP;

  INSERT INTO console.rate_limit_hits (bucket) SELECT unnest(p_buckets);

  -- Keep the table small. The longest window is a day.
  IF random() < 0.02 THEN
    DELETE FROM console.rate_limit_hits WHERE at < now() - interval '2 days';
  END IF;
  RETURN 0;
END;
$$;

COMMENT ON FUNCTION console.rate_limit_take(text[], integer[], integer[]) IS
  'public.rate_limit_take for the console and the start page, on console.rate_limit_hits.';

CREATE OR REPLACE FUNCTION console.rate_limit_retry_at(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
) RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = console, pg_temp
AS $$
  SELECT CASE WHEN count(*) >= p_limit
              THEN (array_agg(h.at ORDER BY h.at DESC))[p_limit] + make_interval(secs => p_window_seconds)
         END
    FROM console.rate_limit_hits h
   WHERE h.bucket = p_bucket
     AND h.at > now() - make_interval(secs => p_window_seconds);
$$;

COMMENT ON FUNCTION console.rate_limit_retry_at(text, integer, integer) IS
  'public.rate_limit_retry_at for the console and the start page, on console.rate_limit_hits. Read only.';

REVOKE EXECUTE ON FUNCTION console.rate_limit_take(text[], integer[], integer[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION console.rate_limit_retry_at(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION console.take_platform_sign_in_attempt(text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION console.rate_limit_take(text[], integer[], integer[]) TO civic_console;
GRANT EXECUTE ON FUNCTION console.rate_limit_retry_at(text, integer, integer) TO civic_console;
GRANT EXECUTE ON FUNCTION console.take_platform_sign_in_attempt(text, text, text, text, integer) TO civic_console;
