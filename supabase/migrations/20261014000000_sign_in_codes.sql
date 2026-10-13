-- Sign-in slice (2026-10-14): lock the code, not the person (additive).
--
-- Adam's decision (2026-10-13): too many wrong guesses burn that one code;
-- nothing locks the address. An address may have up to three live codes at
-- once: asking again sends a new code and the earlier ones keep working until
-- they expire or burn, so a stranger asking for codes cannot make the
-- owner's code stop working. The per-address caps (one email a minute, ten
-- new codes an hour) and the per-IP caps are rate_limit_hits buckets, counted
-- in src/modules/civic.auth/codeRules.ts.
--
-- One row per code, which the old tables could not hold (pending_verifications
-- is unique per (hub_id, email), control_codes per (email, purpose),
-- start_codes per email). So two new tables:
--   sign_in_codes           a hub's sign-in and step-up codes (hub data,
--                           the hub policy, like pending_verifications);
--   platform_sign_in_codes  the console's and the start page's (platform
--                           data, service role only, like control_codes and
--                           start_codes).
-- The old three stay, unread, so code from before this migration keeps
-- working until the new code is live (RUNBOOK-release: migrations first).
-- A code requested on the old code and typed on the new one is not found;
-- the person asks again. A later migration drops the old three.
--
-- Each code also has a link: the "Sign in" link in the email carries a long
-- random token whose hash sits beside the code's (link_hash). A link is
-- checked through the same attempt function as a typed code, with the same
-- expiry, the same tries and the same single use.
--
-- Never raises 40001. No row is deleted or changed.

-- 1. A hub's codes ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sign_in_codes (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  hub_id      text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  email       text NOT NULL,
  code_hash   text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  link_hash   text NULL CHECK (link_hash IS NULL OR link_hash ~ '^[0-9a-f]{64}$'),
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_codes_hub_email_idx ON sign_in_codes (hub_id, email, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sign_in_codes_hub_link_idx ON sign_in_codes (hub_id, link_hash) WHERE link_hash IS NOT NULL;

COMMENT ON TABLE sign_in_codes IS
  'A hub''s emailed sign-in and step-up codes, one row per code, up to three live per address. Only SHA-256 hashes of the code and of its link token. Checked through take_sign_in_attempt; a match is spent by deleting the row. Not exported.';
COMMENT ON COLUMN sign_in_codes.attempts IS
  'Tries spent on this code. At the limit (src/modules/civic.auth/otp.ts) the code is burned: it stops working; the address is not locked.';

SELECT public._civic_apply_hub_policy('public.sign_in_codes');

-- 2. The console's and the start page's codes ------------------------------------------
CREATE TABLE IF NOT EXISTS platform_sign_in_codes (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  realm       text NOT NULL CHECK (realm IN ('console', 'start')),
  purpose     text NOT NULL CHECK (purpose IN ('sign_in', 'step_up')),
  email       text NOT NULL,
  code_hash   text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  link_hash   text NULL CHECK (link_hash IS NULL OR link_hash ~ '^[0-9a-f]{64}$'),
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS platform_sign_in_codes_email_idx ON platform_sign_in_codes (realm, purpose, email, created_at DESC);

COMMENT ON TABLE platform_sign_in_codes IS
  'The console''s and the start page''s emailed codes, one row per code, up to three live per address and purpose. Hashes only. Platform data: service role (src/control/) only.';

ALTER TABLE platform_sign_in_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_sign_in_codes FORCE ROW LEVEL SECURITY;

-- 3. One try at a code, atomically --------------------------------------------------------
-- Spends one try on every live code the guess is checked against and returns
-- them; the caller compares the hash and deletes the matching row (the spend).
-- A typed code names the address (p_email) and is checked against each of its
-- live codes, so each guess costs a try on each: three live codes never mean
-- three times the guesses. A link names its own code (p_link_hash).
-- "Live": not expired and under p_max tries. Nothing is locked.
CREATE OR REPLACE FUNCTION public.take_sign_in_attempt(
  p_hub_id text,
  p_email text,
  p_link_hash text,
  p_max integer
) RETURNS TABLE (id text, email text, code_hash text, link_hash text, attempts integer, expires_at timestamptz)
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  UPDATE sign_in_codes c
     SET attempts = c.attempts + 1
   WHERE c.hub_id = p_hub_id
     AND ((p_email IS NOT NULL AND c.email = p_email)
       OR (p_link_hash IS NOT NULL AND c.link_hash = p_link_hash))
     AND c.attempts < p_max
     AND c.expires_at > now()
  RETURNING c.id, c.email, c.code_hash, c.link_hash, c.attempts, c.expires_at;
$$;

COMMENT ON FUNCTION public.take_sign_in_attempt(text, text, text, integer) IS
  'Spends one try on each live code of p_email (or the one code with p_link_hash) on p_hub_id and returns them. The caller compares and deletes the matching row. A code at p_max tries is burned; no address is locked.';

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
  UPDATE platform_sign_in_codes c
     SET attempts = c.attempts + 1
   WHERE c.realm = p_realm
     AND c.purpose = p_purpose
     AND ((p_email IS NOT NULL AND c.email = p_email)
       OR (p_link_hash IS NOT NULL AND c.link_hash = p_link_hash))
     AND c.attempts < p_max
     AND c.expires_at > now()
  RETURNING c.id, c.email, c.code_hash, c.link_hash, c.attempts, c.expires_at;
$$;

COMMENT ON FUNCTION public.take_platform_sign_in_attempt(text, text, text, text, integer) IS
  'take_sign_in_attempt for the console and the start page (platform_sign_in_codes).';

-- 4. When a full bucket has room again ------------------------------------------------------
-- For the plain "Try again after 4:10 PM": the moment the oldest hit that
-- keeps the bucket full leaves its window. Null when the bucket has room.
CREATE OR REPLACE FUNCTION public.rate_limit_retry_at(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
) RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN count(*) >= p_limit
              THEN (array_agg(h.at ORDER BY h.at DESC))[p_limit] + make_interval(secs => p_window_seconds)
         END
    FROM rate_limit_hits h
   WHERE h.bucket = p_bucket
     AND h.at > now() - make_interval(secs => p_window_seconds);
$$;

COMMENT ON FUNCTION public.rate_limit_retry_at(text, integer, integer) IS
  'When bucket p_bucket (limit p_limit per p_window_seconds) next has room, or null if it has room now. Read only.';

-- 5. Grants -------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON sign_in_codes TO authenticated, service_role;
    REVOKE ALL ON platform_sign_in_codes FROM authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform_sign_in_codes TO service_role;
    GRANT EXECUTE ON FUNCTION public.take_sign_in_attempt(text, text, text, integer) TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.take_platform_sign_in_attempt(text, text, text, text, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.rate_limit_retry_at(text, integer, integer) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON sign_in_codes, platform_sign_in_codes FROM anon;
    REVOKE ALL ON FUNCTION public.take_sign_in_attempt(text, text, text, integer) FROM anon;
    REVOKE ALL ON FUNCTION public.take_platform_sign_in_attempt(text, text, text, text, integer) FROM anon;
    REVOKE ALL ON FUNCTION public.rate_limit_retry_at(text, integer, integer) FROM anon;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.take_sign_in_attempt(text, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.take_platform_sign_in_attempt(text, text, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rate_limit_retry_at(text, integer, integer) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
