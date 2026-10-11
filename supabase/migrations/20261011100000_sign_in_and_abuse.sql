-- Audit 2: sign-in that can't be brute-forced, demo sessions that can't become
-- admin sessions, and limits on paid AI calls (2026-10-11, with Adam).
--
-- WHAT.
--
--   1. Wrong-code counting is atomic. take_code_attempt (a hub's codes),
--      take_control_code_attempt (the console's) and take_start_code_attempt
--      (the start page's) each spend one attempt in ONE conditional UPDATE:
--      the row comes back only while attempts are under the limit and no lock
--      is running, and the attempt that reaches the limit sets the lock in the
--      same statement. The caller compares the code only when a row comes
--      back. Before this, N concurrent guesses all read the same count and
--      advanced it by about one.
--
--   2. Rate limits for every sign-in step live in one platform table,
--      rate_limit_hits, behind rate_limit_take(): it locks each named bucket
--      (an advisory lock per bucket, taken in a fixed order), counts, and
--      records the attempt only when every bucket is under its limit, all in
--      one transaction. The start page's start_attempts did count-then-insert
--      from the app, so two racing requests could both pass; it is retired
--      here (left in place, unused; a later migration drops it).
--
--   3. Hub session tokens and sign-in codes are stored only as SHA-256
--      hashes, as the console's and the start page's already were.
--      `sessions.token` keeps its name and its primary key and now holds the
--      hash (CHECK: 64 hex characters, so a plaintext token cannot be written
--      again). `pending_verifications.code` must be NULL; `code_hash` replaces
--      it.
--
--   4. Every session carries an assurance level: 'code' (the person typed a
--      code we emailed them, or came through the start page's emailed code)
--      or 'demo' (a demo hub's "any six digits"). No default, so every insert
--      has to say which. The app never lets a demo session pass an admin,
--      official or announcement-poster check, and reads it as signed out once
--      the hub is not a demo. Three triggers end demo sessions the moment
--      they could matter:
--        - a hub leaves demo mode: its demo sessions end (Adam: only demo
--          sessions, so the admin making the switch stays signed in);
--        - an address is written into a privilege list (people.admin_emails,
--          people.board_emails, people.announcement_authors and its legacy
--          key announcement_authors): that address's non-code sessions on
--          the hub end;
--        - an account is made an official (users.official_type set): its
--          non-code sessions end.
--      Triggers rather than calls in each writer, so the console, the
--      handover, Settings and operator scripts are all covered.
--
--   5. ai_usage: one row per paid model call made for a hub (purpose, model,
--      tokens, web searches; no account id, so it never says who used the
--      assistant when). ai_tokens_since() sums it for the per-hub daily
--      budget. Hub data with the template policy; not exported.
--
-- NON-ADDITIVE, approved by Adam 2026-10-11: every existing session and every
-- pending sign-in code is deleted. They are plaintext bearer credentials that
-- nothing can use once lookups are by hash; deleting them keeps them out of
-- the database and the nightly dumps. Everyone on every hub is signed out
-- once, when this runs. Adam picks the release time.
--
-- RLS: the hub functions are SECURITY INVOKER and touch only rows carrying
-- p_hub_id, so the hub policies of 20260925000000 apply inside them. The
-- platform functions and rate_limit_hits are for the service role only.

-- 1. Sessions: hashed, with an assurance level --------------------------------------
DELETE FROM sessions;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS assurance text;
ALTER TABLE sessions ALTER COLUMN assurance SET NOT NULL;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_assurance_chk;
ALTER TABLE sessions ADD CONSTRAINT sessions_assurance_chk CHECK (assurance IN ('code', 'demo'));
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_token_is_hash;
ALTER TABLE sessions ADD CONSTRAINT sessions_token_is_hash CHECK (token ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN sessions.token IS
  'SHA-256 (hex) of the bearer token. The token itself is never stored; a lookup hashes what the browser presents. Constraint sessions_token_is_hash.';
COMMENT ON COLUMN sessions.assurance IS
  'code: the holder typed a code emailed to them (or the start page''s). demo: a demo hub''s any-six-digits sign-in. A demo session never passes an admin, official or poster check and is signed out once the hub leaves demo.';

-- 2. Sign-in codes: hashed -----------------------------------------------------------
DELETE FROM pending_verifications;

ALTER TABLE pending_verifications ADD COLUMN IF NOT EXISTS code_hash text;
ALTER TABLE pending_verifications ALTER COLUMN code_hash SET NOT NULL;
ALTER TABLE pending_verifications DROP CONSTRAINT IF EXISTS pending_verifications_code_hash_chk;
ALTER TABLE pending_verifications ADD CONSTRAINT pending_verifications_code_hash_chk CHECK (code_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE pending_verifications ALTER COLUMN code DROP NOT NULL;
ALTER TABLE pending_verifications DROP CONSTRAINT IF EXISTS pending_verifications_no_plain_code;
ALTER TABLE pending_verifications ADD CONSTRAINT pending_verifications_no_plain_code CHECK (code IS NULL);

COMMENT ON COLUMN pending_verifications.code IS
  'Always NULL (constraint pending_verifications_no_plain_code). Codes are stored only as code_hash since 2026-10-11; kept so older readers find the column.';
COMMENT ON COLUMN pending_verifications.code_hash IS
  'SHA-256 (hex) of the emailed six-digit code. Checked through take_code_attempt, one attempt at a time.';

-- 3. One attempt at a code, atomically ------------------------------------------------
CREATE OR REPLACE FUNCTION public.take_code_attempt(
  p_hub_id text,
  p_email text,
  p_max integer,
  p_lock_seconds integer
) RETURNS TABLE (code_hash text, expires_at timestamptz, attempts integer)
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  UPDATE pending_verifications pv
     SET attempts = pv.attempts + 1,
         locked_until = CASE
           WHEN pv.attempts + 1 >= p_max THEN now() + make_interval(secs => p_lock_seconds)
           ELSE pv.locked_until
         END
   WHERE pv.hub_id = p_hub_id
     AND pv.email = p_email
     AND pv.attempts < p_max
     AND (pv.locked_until IS NULL OR pv.locked_until <= now())
  RETURNING pv.code_hash, pv.expires_at, pv.attempts;
$$;

COMMENT ON FUNCTION public.take_code_attempt(text, text, integer, integer) IS
  'Spends one attempt at this address''s pending code on p_hub_id and returns the code''s hash, or no row when none is left (no code, at the limit, or locked). The attempt that reaches p_max locks the address for p_lock_seconds. The caller compares, then deletes the row on a match.';

CREATE OR REPLACE FUNCTION public.take_control_code_attempt(
  p_email text,
  p_purpose text,
  p_max integer,
  p_lock_seconds integer
) RETURNS TABLE (code_hash text, expires_at timestamptz, attempts integer)
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  UPDATE control_codes c
     SET attempts = c.attempts + 1,
         locked_until = CASE
           WHEN c.attempts + 1 >= p_max THEN now() + make_interval(secs => p_lock_seconds)
           ELSE c.locked_until
         END
   WHERE c.email = p_email
     AND c.purpose = p_purpose
     AND c.attempts < p_max
     AND (c.locked_until IS NULL OR c.locked_until <= now())
  RETURNING c.code_hash, c.expires_at, c.attempts;
$$;

CREATE OR REPLACE FUNCTION public.take_start_code_attempt(
  p_email text,
  p_max integer,
  p_lock_seconds integer
) RETURNS TABLE (code_hash text, expires_at timestamptz, attempts integer)
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  UPDATE start_codes s
     SET attempts = s.attempts + 1,
         locked_until = CASE
           WHEN s.attempts + 1 >= p_max THEN now() + make_interval(secs => p_lock_seconds)
           ELSE s.locked_until
         END
   WHERE s.email = p_email
     AND s.attempts < p_max
     AND (s.locked_until IS NULL OR s.locked_until <= now())
  RETURNING s.code_hash, s.expires_at, s.attempts;
$$;

-- 4. Rate limits ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- "<step>:<by>:<sha256>", built in src/db/rateLimit.ts. IPs, addresses and
  -- account ids are hashed before they get here.
  bucket text NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limit_hits_bucket_at_idx ON rate_limit_hits (bucket, at DESC);
CREATE INDEX IF NOT EXISTS rate_limit_hits_at_idx ON rate_limit_hits (at);

COMMENT ON TABLE rate_limit_hits IS
  'One row per attempt that a rate limit counted (sign-in steps on hubs, the console and the start page; assistant calls), by hashed bucket. Platform data, written only through rate_limit_take(). Rows older than two days are pruned.';

ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_hits FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rate_limit_take(
  p_buckets text[],
  p_limits integer[],
  p_window_seconds integer[]
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
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

  -- One lock per bucket, taken in sorted order so two calls naming the same
  -- buckets cannot deadlock. Held to the end of the transaction: the count
  -- and the insert below are one step for anyone else asking about a bucket.
  FOR b IN SELECT DISTINCT x FROM unnest(p_buckets) AS x ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('civic.rate_limit:' || b, 0));
  END LOOP;

  FOR i IN 1..n LOOP
    SELECT count(*) INTO used
      FROM rate_limit_hits
     WHERE bucket = p_buckets[i]
       AND at > now() - make_interval(secs => p_window_seconds[i]);
    IF used >= p_limits[i] THEN
      RETURN i; -- refused, and not counted: waiting is enough to get back in
    END IF;
  END LOOP;

  INSERT INTO rate_limit_hits (bucket) SELECT unnest(p_buckets);

  -- Keep the table small. The longest window is a day.
  IF random() < 0.02 THEN
    DELETE FROM rate_limit_hits WHERE at < now() - interval '2 days';
  END IF;
  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_take(text[], integer[], integer[]) IS
  'Records one attempt in every named bucket and returns 0, or returns the 1-based index of the first bucket already at its limit within its window and records nothing. Atomic per bucket (advisory locks).';

COMMENT ON TABLE start_attempts IS
  'RETIRED 2026-10-11: the start page''s limits moved to rate_limit_hits / rate_limit_take(). Nothing reads or writes it; a later migration drops it.';

-- 5. Demo sessions end when they could matter -----------------------------------------

-- The non-code sessions of these addresses on this hub.
CREATE OR REPLACE FUNCTION public._civic_end_unverified_sessions(p_hub_id text, p_emails text[])
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  DELETE FROM sessions s
   USING users u
   WHERE s.hub_id = p_hub_id
     AND u.hub_id = p_hub_id
     AND u.id = s.user_id
     AND s.assurance <> 'code'
     AND lower(u.email) = ANY (p_emails);
$$;

-- Any address written into a privilege list. Every address in the new value,
-- not only the added ones: a listed address should hold no demo session at
-- all (a privileged address never gets one), so this is idempotent. The
-- pattern pulls addresses out of every stored shape (a JSON array of strings,
-- a comma list, the authors' JSON objects).
CREATE OR REPLACE FUNCTION public._civic_privilege_list_written()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.key IN (
    'people.admin_emails',
    'people.board_emails',
    'people.announcement_authors',
    'announcement_authors'
  ) THEN
    PERFORM public._civic_end_unverified_sessions(
      NEW.hub_id,
      ARRAY(
        SELECT DISTINCT lower(m[1])
          FROM regexp_matches(NEW.value, '([^][\s",;{}:<>]+@[^][\s",;{}:<>]+)', 'g') AS m
      )
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS hub_settings_privilege_sessions ON hub_settings;
CREATE TRIGGER hub_settings_privilege_sessions
  AFTER INSERT OR UPDATE OF value ON hub_settings
  FOR EACH ROW EXECUTE FUNCTION public._civic_privilege_list_written();

CREATE OR REPLACE FUNCTION public._civic_official_designated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM sessions
   WHERE hub_id = NEW.hub_id
     AND user_id = NEW.id
     AND assurance <> 'code';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS users_official_sessions ON users;
CREATE TRIGGER users_official_sessions
  AFTER UPDATE OF official_type ON users
  FOR EACH ROW
  WHEN (NEW.official_type IS NOT NULL AND NEW.official_type IS DISTINCT FROM OLD.official_type)
  EXECUTE FUNCTION public._civic_official_designated();

CREATE OR REPLACE FUNCTION public._civic_hub_left_demo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM sessions WHERE hub_id = NEW.id AND assurance = 'demo';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS hubs_left_demo_sessions ON hubs;
CREATE TRIGGER hubs_left_demo_sessions
  AFTER UPDATE OF mode ON hubs
  FOR EACH ROW
  WHEN (OLD.mode = 'demo' AND NEW.mode IS DISTINCT FROM 'demo')
  EXECUTE FUNCTION public._civic_hub_left_demo();

-- 6. AI usage, for the per-hub daily budget ------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  hub_id        text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  -- What the call was for: "assistant.message", "assistant.suggest",
  -- "assistant.review" (the Code of Conduct check), or a job's purpose.
  purpose       text NOT NULL,
  model         text NOT NULL,
  input_tokens  integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  web_searches  integer NOT NULL DEFAULT 0 CHECK (web_searches >= 0),
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_hub_at_idx ON ai_usage (hub_id, at DESC);

COMMENT ON TABLE ai_usage IS
  'One row per paid model call made for a hub: purpose, model, tokens, web searches. No account id, on purpose. Read for the per-hub daily token budget (ai_tokens_since). Operational; not exported.';

SELECT public._civic_apply_hub_policy('public.ai_usage');

CREATE OR REPLACE FUNCTION public.ai_tokens_since(
  p_hub_id text,
  p_since timestamptz,
  p_purposes text[]
) RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(input_tokens + output_tokens), 0)::bigint
    FROM ai_usage
   WHERE hub_id = p_hub_id
     AND at >= p_since
     AND purpose = ANY (p_purposes);
$$;

-- 7. Grants ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, DELETE ON ai_usage TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.take_code_attempt(text, text, integer, integer) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.ai_tokens_since(text, timestamptz, text[]) TO authenticated, service_role;
    REVOKE ALL ON rate_limit_hits FROM anon, authenticated;
    GRANT SELECT, INSERT, DELETE ON rate_limit_hits TO service_role;
    GRANT EXECUTE ON FUNCTION public.rate_limit_take(text[], integer[], integer[]) TO service_role;
    GRANT EXECUTE ON FUNCTION public.take_control_code_attempt(text, text, integer, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.take_start_code_attempt(text, integer, integer) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ai_usage FROM anon;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.rate_limit_take(text[], integer[], integer[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.take_control_code_attempt(text, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.take_start_code_attempt(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.take_code_attempt(text, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tokens_since(text, timestamptz, text[]) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
