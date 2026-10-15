-- Leaving demo (2026-10-15): a hub admin takes a demo hub to beta and to live
-- with nothing surprising them or their residents. Additive: two columns, one
-- table. No row is changed, no function is added.
--
--   users.demo_only            the account was made by a demo hub's "any six
--                              digits" sign-in and has never typed a real
--                              code. Once the hub leaves demo it no longer
--                              counts as a member (Adam, 2026-10-15); what it
--                              added stays. Cleared the first time the person
--                              signs in with a real code. Existing rows stay
--                              false: nothing recorded which of them were made
--                              that way, so they keep counting, as today.
--   waitlist.told_open_at      when this person was emailed that the hub is
--                              open (the switch to live, ticked by default).
--                              Nobody is told twice.
--   admin_digest_marks         per hub, the moment the last admin digest that
--                              went out covered up to. The next one counts only
--                              what arrived after it, so no item is ever sent
--                              twice and a missed day loses nothing.
--
-- Never raises 40001.

-- 1. Demo-only accounts ------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_only boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN users.demo_only IS
  'Made by a demo hub''s any-six-digits sign-in and never signed in with a real code since. Not counted as a member once the hub leaves demo; its content stays.';

-- 2. Waitlist told the hub is open -------------------------------------------
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS told_open_at timestamptz NULL;
COMMENT ON COLUMN waitlist.told_open_at IS
  'When this person was emailed that the hub had opened (on the switch to live). Null: not told. Nobody is told twice.';

-- 3. The admin digest's mark --------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_digest_marks (
  hub_id         text PRIMARY KEY REFERENCES hubs(id) ON DELETE CASCADE,
  covered_until  timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE admin_digest_marks IS
  'Per hub, the moment the last admin digest that went out covered up to. The next digest counts as new only what arrived after it.';

SELECT public._civic_apply_hub_policy('public.admin_digest_marks');

-- 4. Grants -------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON admin_digest_marks TO authenticated, service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON admin_digest_marks FROM anon;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
