-- `hubs.mode` becomes the only source of a hub's lifecycle state, and moving
-- INTO demo becomes impossible after creation.
--
-- WHY THE BACKFILL VALUES. Until now `mode` was nullable and a null fell back
-- to the environment variables, which is what made the column safe to add to a
-- live database. That fallback is now removed, so the rows have to say what
-- the env vars were saying.
--
--   floyd -> 'beta'   Confirmed with Adam, 2026-09-22: Floyd is in private
--                     beta today. Sign-in is limited to the allowlist and the
--                     waitlist is offered to everyone else. Getting this wrong
--                     in the other direction would open a real jurisdiction's
--                     hub to anyone, so it is stated here rather than derived.
--   others -> 'live'  No other row exists in production. A hub that has not
--                     been told otherwise is an ordinary hub.
--
-- THE CUTOVER MUST CHECK THIS. Before applying, confirm Floyd is still in beta
-- (`select mode from hubs where id = 'floyd'` afterwards should read 'beta').
-- If Floyd has gone live in the meantime, fix the row, not this file.

UPDATE hubs SET mode = 'beta' WHERE id = 'floyd' AND mode IS NULL;
UPDATE hubs SET mode = 'live' WHERE mode IS NULL;

ALTER TABLE hubs ALTER COLUMN mode SET DEFAULT 'live';
ALTER TABLE hubs ALTER COLUMN mode SET NOT NULL;

ALTER TABLE hubs DROP CONSTRAINT IF EXISTS hubs_mode_check;
ALTER TABLE hubs
  ADD CONSTRAINT hubs_mode_check CHECK (mode IN ('demo', 'beta', 'live'));

-- Demo is set at creation, and never afterwards.
--
-- Demo is the one mode that relaxes sign-in, so a hub arriving in it by way of
-- an UPDATE is the shape of the worst mistake available here: a real
-- jurisdiction's hub quietly becoming one where anyone can sign in. A demo
-- graduating to beta or live is fine and expected — the restriction is
-- one-directional.
--
-- Enforced in the database rather than only in code because "no code path
-- does this" is a claim that has to be re-proved on every change, and because
-- the control plane, a migration, a script and a future admin form are four
-- different code paths. A trigger is one.
CREATE OR REPLACE FUNCTION hubs_forbid_entering_demo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.mode = 'demo' AND OLD.mode IS DISTINCT FROM 'demo' THEN
    RAISE EXCEPTION
      'A hub cannot be moved into demo mode. Demo is set when the hub is created. (hub: %, was: %)',
      OLD.id, OLD.mode
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hubs_forbid_entering_demo_trigger ON hubs;
CREATE TRIGGER hubs_forbid_entering_demo_trigger
  BEFORE UPDATE OF mode ON hubs
  FOR EACH ROW EXECUTE FUNCTION hubs_forbid_entering_demo();

COMMENT ON COLUMN hubs.mode IS
  'Lifecycle state: demo | beta | live. Authoritative — nothing falls back to env. Demo is set at creation only; a trigger refuses any update into it.';
