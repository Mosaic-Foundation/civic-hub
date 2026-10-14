-- Members and invites (2026-10-14): a hub feels like a group of people, and any
-- member can bring a neighbour in, without exposing anyone who'd rather not be
-- seen. Additive: two columns, one table, one function. No row is changed.
--
--   users.hidden_from_members  one switch in the person's own settings: off the
--                              Members page and the home page's avatar stack.
--                              The member count still includes them. Admins
--                              see them in Settings → People.
--   waitlist.invited_by        on a beta hub a member's invite sends no email
--                              (Adam, 2026-10-14): the address goes on the
--                              waitlist, marked with who invited it.
--   hub_invites                one row per address a member asked to invite.
--                              'emailed' and 'waitlisted' rows are the record
--                              that the address was invited: at most one per
--                              hub and address, ever, so nobody is invited
--                              twice. 'skipped' rows (already invited, already
--                              has an account) are kept so they count toward
--                              the inviter's daily limit like any other
--                              address: the limit must not tell a member
--                              which of their addresses already belong to the
--                              hub. The emailed invite's link token is stored
--                              as a SHA-256 hash only. The member's message is
--                              never stored.
--   take_member_invites()      the daily limit and the no-repeat rule in one
--                              transaction, under a lock per inviter, so two
--                              racing requests cannot both take the last
--                              slots. SECURITY INVOKER: the hub policy applies.
--
-- Never raises 40001.

-- 1. Hiding oneself -----------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_from_members boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN users.hidden_from_members IS
  'The person chose to be left off the Members page and the avatar stack. Still counted in "N members"; admins see them in Settings → People.';

-- 2. Who invited a waitlisted address ----------------------------------------
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invited_by text NULL REFERENCES users(id) ON DELETE SET NULL;
COMMENT ON COLUMN waitlist.invited_by IS
  'The member whose invite put this address on a beta hub''s waitlist; null when the person asked themselves, or the member has since deleted their account.';

-- 3. Invites ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hub_invites (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  hub_id      text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) > 2),
  invited_by  text NULL REFERENCES users(id) ON DELETE SET NULL,
  outcome     text NOT NULL CHECK (outcome IN ('emailed', 'waitlisted', 'skipped')),
  link_hash   text NULL CHECK (link_hash IS NULL OR link_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NULL,
  used_at     timestamptz NULL,
  CONSTRAINT hub_invites_link_only_when_emailed CHECK (link_hash IS NULL OR outcome = 'emailed')
);
-- At most one real invite per address, ever.
CREATE UNIQUE INDEX IF NOT EXISTS hub_invites_once_idx ON hub_invites (hub_id, email) WHERE outcome <> 'skipped';
CREATE UNIQUE INDEX IF NOT EXISTS hub_invites_link_idx ON hub_invites (hub_id, link_hash) WHERE link_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS hub_invites_inviter_idx ON hub_invites (hub_id, invited_by, created_at DESC);

COMMENT ON TABLE hub_invites IS
  'One row per address a member asked to invite: emailed (with a hashed 14-day link), waitlisted (a member''s invite on a beta hub), or skipped (already invited or already has an account; kept for the daily limit). At most one emailed or waitlisted row per address. The message is never stored.';
COMMENT ON COLUMN hub_invites.used_at IS
  'When the invite link signed someone in. A link works once.';

SELECT public._civic_apply_hub_policy('public.hub_invites');

-- 4. Taking invites, atomically ----------------------------------------------
-- p_emails are normalized by the caller (lower-case, trimmed, distinct);
-- p_link_hashes runs alongside them (null entries for a waitlisted outcome).
-- Each address, in order: past the inviter's limit for the window → 'over_limit'
-- (not recorded); already invited or already an account here → 'skipped'
-- (recorded, counts); otherwise → 'new' (recorded with p_outcome, counts).
CREATE OR REPLACE FUNCTION public.take_member_invites(
  p_hub_id text,
  p_user_id text,
  p_emails text[],
  p_link_hashes text[],
  p_outcome text,
  p_expires_at timestamptz,
  p_limit integer,
  p_window_seconds integer
) RETURNS TABLE (email text, status text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  n integer := coalesce(array_length(p_emails, 1), 0);
  used integer;
  i integer;
  e text;
  inserted integer;
BEGIN
  IF p_outcome NOT IN ('emailed', 'waitlisted') THEN
    RAISE EXCEPTION 'take_member_invites: outcome must be emailed or waitlisted' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(array_length(p_link_hashes, 1), 0) <> n THEN
    RAISE EXCEPTION 'take_member_invites: emails and link hashes must be the same length' USING ERRCODE = 'P0001';
  END IF;

  -- One inviter at a time on this hub; released at the end of the transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('civic-invites:' || p_hub_id || ':' || p_user_id, 0));

  SELECT count(*) INTO used
    FROM hub_invites h
   WHERE h.hub_id = p_hub_id
     AND h.invited_by = p_user_id
     AND h.created_at > now() - make_interval(secs => p_window_seconds);

  FOR i IN 1..n LOOP
    e := p_emails[i];
    IF used >= p_limit THEN
      email := e; status := 'over_limit';
      RETURN NEXT;
      CONTINUE;
    END IF;

    inserted := 0;
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.hub_id = p_hub_id AND lower(u.email) = e) THEN
      INSERT INTO hub_invites (hub_id, email, invited_by, outcome, link_hash, expires_at)
      VALUES (p_hub_id, e, p_user_id, p_outcome,
              CASE WHEN p_outcome = 'emailed' THEN p_link_hashes[i] END,
              CASE WHEN p_outcome = 'emailed' THEN p_expires_at END)
      ON CONFLICT (hub_id, email) WHERE outcome <> 'skipped' DO NOTHING;
      GET DIAGNOSTICS inserted = ROW_COUNT;
    END IF;

    IF inserted = 0 THEN
      INSERT INTO hub_invites (hub_id, email, invited_by, outcome)
      VALUES (p_hub_id, e, p_user_id, 'skipped');
      email := e; status := 'skipped';
    ELSE
      email := e; status := 'new';
    END IF;
    used := used + 1;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.take_member_invites(text, text, text[], text[], text, timestamptz, integer, integer) IS
  'A member''s invites, under a lock per inviter: each address is new (recorded), skipped (already invited or has an account; recorded) or over_limit (not recorded). Every recorded address counts toward p_limit per p_window_seconds.';

-- 5. Grants -------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hub_invites TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.take_member_invites(text, text, text[], text[], text, timestamptz, integer, integer) TO authenticated, service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON hub_invites FROM anon;
    REVOKE ALL ON FUNCTION public.take_member_invites(text, text, text[], text[], text, timestamptz, integer, integer) FROM anon;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.take_member_invites(text, text, text[], text[], text, timestamptz, integer, integer) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
