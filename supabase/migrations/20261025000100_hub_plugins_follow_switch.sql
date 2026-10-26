-- A hub's install record follows its plugin switch (plugin session 1,
-- ADR-014). Additive: one function, one trigger. No row changes.
--
-- plugin.<id>.enabled stays the runtime gate, and more than one thing writes
-- it: the Plugins page (through apply_plugin_change), the console's plugin
-- boxes, a settings save, a hub import. So the record in hub_plugins is kept
-- equal to the switch here, in the same transaction as the write, whoever
-- made it:
--   switched off   every installed package of that plugin is stamped removed
--                  (removed_by: the setting's updated_by, else 'settings'), and
--                  a wind-down in progress ends;
--   switched on    (or the row deleted: unset reads as on) the stamp is cleared.
-- Running it twice changes nothing. Never raises 40001.

CREATE OR REPLACE FUNCTION public._civic_hub_plugins_follow_switch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row hub_settings%ROWTYPE;
  v_plugin text;
  v_off boolean;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF v_row.key !~ '^plugin\.[a-z_]+\.enabled$' THEN
    RETURN NULL;
  END IF;
  v_plugin := split_part(v_row.key, '.', 2);
  v_off := TG_OP <> 'DELETE' AND lower(btrim(NEW.value)) IN ('false', '0', 'off', 'no');
  IF v_off THEN
    UPDATE hub_plugins
       SET removed_at = now(), removed_by = coalesce(nullif(NEW.updated_by, ''), 'settings'),
           winding_down_since = NULL, winding_down_by = NULL, updated_at = now()
     WHERE hub_id = v_row.hub_id AND plugin = v_plugin AND removed_at IS NULL;
  ELSE
    UPDATE hub_plugins
       SET removed_at = NULL, removed_by = NULL, updated_at = now()
     WHERE hub_id = v_row.hub_id AND plugin = v_plugin AND removed_at IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public._civic_hub_plugins_follow_switch() IS
  'Keeps hub_plugins.removed_at equal to the plugin switch (plugin.<id>.enabled), whoever writes it (ADR-014). SECURITY DEFINER: it writes hub_plugins for the hub the settings row names, and nothing else.';

DROP TRIGGER IF EXISTS hub_settings_plugin_switch ON hub_settings;
CREATE TRIGGER hub_settings_plugin_switch
  AFTER INSERT OR UPDATE OF value OR DELETE ON hub_settings
  FOR EACH ROW EXECUTE FUNCTION public._civic_hub_plugins_follow_switch();

DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_hub_plugins_follow_switch() FROM %I', r);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._civic_hub_plugins_follow_switch() FROM PUBLIC;
