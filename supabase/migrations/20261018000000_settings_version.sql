-- A per-hub settings version, so a saved setting reaches every server at once.
--
-- Each server instance keeps a hub's settings (and its registry row) in
-- memory. A save cleared only the instance that took it, so the others served
-- the old values for up to a minute (the Mode page said so). Now every change
-- to a hub's settings or to its registry row bumps hubs.settings_version, the
-- resolver reads the hub row on every request (one indexed query), and a
-- server whose cached settings carry an older version reloads them.
--
-- The bump is done here, by triggers, so no writer can miss it: the hub's own
-- admin routes, the console, the operator scripts and a hand edit in the SQL
-- editor all bump it.
--
--   hub_settings  any insert, update or delete bumps its hub's version
--                 (_civic_bump_settings_version). SECURITY DEFINER because the
--                 hub writes its settings as `authenticated` under a minted
--                 hub token, and `hubs` (forced RLS, no policy) is not writable
--                 by that role. The function touches one column of one row,
--                 the hub the written row names.
--   hubs          an update that changes anything but the version itself (and
--                 updated_at) bumps it (_civic_hubs_version_on_change): mode,
--                 name, status, hostname.
--
-- Trigger functions get no EXECUTE grant (Postgres checks it when a trigger
-- is created, not when it fires; 20261012100000), so both are revoked from
-- every role explicitly.
--
-- Additive: one column with a default, two functions, two triggers. Old code
-- does not read the column. Never raises.

ALTER TABLE hubs ADD COLUMN IF NOT EXISTS settings_version bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN hubs.settings_version IS
  'Bumped by trigger on every change to the hub''s hub_settings rows or to this row. Servers compare it with their cached settings and reload on a mismatch.';

CREATE OR REPLACE FUNCTION public._civic_bump_settings_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target text := CASE WHEN TG_OP = 'DELETE' THEN OLD.hub_id ELSE NEW.hub_id END;
BEGIN
  UPDATE hubs SET settings_version = settings_version + 1 WHERE id = target;
  IF TG_OP = 'UPDATE' AND OLD.hub_id IS DISTINCT FROM NEW.hub_id THEN
    UPDATE hubs SET settings_version = settings_version + 1 WHERE id = OLD.hub_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS hub_settings_bump_version ON hub_settings;
CREATE TRIGGER hub_settings_bump_version
  AFTER INSERT OR UPDATE OR DELETE ON hub_settings
  FOR EACH ROW EXECUTE FUNCTION public._civic_bump_settings_version();

CREATE OR REPLACE FUNCTION public._civic_hubs_version_on_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.settings_version = OLD.settings_version
     AND (to_jsonb(NEW) - 'settings_version' - 'updated_at')
         IS DISTINCT FROM (to_jsonb(OLD) - 'settings_version' - 'updated_at') THEN
    NEW.settings_version := OLD.settings_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hubs_bump_version ON hubs;
CREATE TRIGGER hubs_bump_version
  BEFORE UPDATE ON hubs
  FOR EACH ROW EXECUTE FUNCTION public._civic_hubs_version_on_change();

DO $$
DECLARE
  r text;
BEGIN
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_bump_settings_version() FROM %I', r);
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_hubs_version_on_change() FROM %I', r);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public._civic_bump_settings_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_hubs_version_on_change() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
