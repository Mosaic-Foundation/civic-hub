-- Going live needs the platform's approval (Adam, 2026-11-19).
--
-- People can now start their own hubs from the start page. Those hubs may be
-- demos and betas, but a live hub runs under an agreement with Civic.Social,
-- so a hub's own admins may move it to live only once the platform operator
-- has approved it in the console. Until then Hub settings → Mode shows Live
-- as unavailable and says whom to write to.
--
-- `live_approved_at` is that approval: set and cleared only by the console
-- (src/operator/hubs.ts, setHubLiveApproval). The hub's admin form never
-- writes it.
--
-- The rule is checked in code first (hubModeChangeRejectionReason, a readable
-- refusal), and here as the backstop, for the same reason demo is: the admin
-- form, a script and a future path are different code, and a trigger is one.
--
--   - A hub created live (by the console or an operator script, never the
--     start page, which creates demos only) is approved by being created so.
--   - An update that moves a hub INTO live needs the approval already set.
--     Staying live, and going back from live to beta, are untouched.
--   - Clearing the approval of a live hub does not take it down: it only
--     means the hub cannot come back to live by itself after leaving it.

ALTER TABLE hubs ADD COLUMN IF NOT EXISTS live_approved_at timestamptz;

COMMENT ON COLUMN hubs.live_approved_at IS
  'When the platform operator approved this hub for live mode (an agreement is in place). Null: the hub''s admins cannot move it to live. Set by the console only.';

-- Every hub live today was put there before this rule, with the operator's
-- knowledge: approved as of now.
UPDATE hubs SET live_approved_at = now() WHERE mode = 'live' AND live_approved_at IS NULL;

CREATE OR REPLACE FUNCTION hubs_live_needs_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.mode = 'live' AND NEW.live_approved_at IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.live_approved_at := now();
    ELSIF OLD.mode IS DISTINCT FROM 'live' THEN
      RAISE EXCEPTION
        'A hub cannot be moved to live until the platform has approved it. (hub: %, was: %)',
        OLD.id, OLD.mode
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hubs_live_needs_approval_trigger ON hubs;
CREATE TRIGGER hubs_live_needs_approval_trigger
  BEFORE INSERT OR UPDATE OF mode ON hubs
  FOR EACH ROW EXECUTE FUNCTION hubs_live_needs_approval();

-- A trigger function is never called directly: no one needs EXECUTE on it
-- (tests/api/functionGrants.test.ts).
REVOKE ALL ON FUNCTION hubs_live_needs_approval() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION hubs_live_needs_approval() FROM %I', r);
    END IF;
  END LOOP;
END $$;
