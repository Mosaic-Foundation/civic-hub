-- Plugin packages: the console's catalog and each hub's installs (plugin
-- session 1, ADR-014). Additive: two tables, three functions, one trigger.
-- No existing row changes; the plugin switches (plugin.<id>.enabled) stay the
-- runtime gate and old code keeps working on a migrated database.
--
--   plugin_catalog   platform data, across hubs: one row per package version
--                    and content hash. `npm run catalog:add` writes a row as a
--                    migration, status 'pending', when the conformance suite
--                    passes; the operator approves it in the console (fresh
--                    code, audited). The loader mounts a package only when an
--                    approved row records the exact hash of its files. Never
--                    deleted: a row is withdrawn.
--   hub_plugins      per hub, under the hub template: which version of each
--                    package the hub installed, the grant it recorded, who
--                    installed or removed it and when, and whether it is
--                    winding down. Written by apply_plugin_change() and by the
--                    new-hub trigger.
--   apply_plugin_change(hub, plugin, change, packages, settings, actor)
--                    one transaction for an install, a removal or a wind-down:
--                    the hub's install rows and its plugin settings
--                    (plugin.<id>.enabled, plugin.<id>.winding_down, the
--                    section order) together, or neither.
--   _civic_install_approved_plugins(hub)
--                    records every approved package as installed on a hub
--                    (the newest approved version of each); called by the
--                    trigger on a new hub, so a new hub gets every approved
--                    package (Adam, 2026-10-25). Leaves existing rows alone.
--
-- Never raises 40001. Every function's EXECUTE is granted explicitly.

-- 1. The catalog ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plugin_catalog (
  id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  package       text        NOT NULL,
  version       text        NOT NULL,
  hash          text        NOT NULL,
  display_name  text        NOT NULL,
  plugin        text        NOT NULL,
  process_type  text        NOT NULL,
  capabilities  jsonb       NOT NULL,
  conformance   jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'pending',
  approved_by   text,
  approved_at   timestamptz,
  withdrawn_at  timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plugin_catalog_package_chk CHECK (package ~ '^@[a-z0-9-]+/[a-z0-9._-]+$'),
  CONSTRAINT plugin_catalog_version_chk CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT plugin_catalog_hash_chk CHECK (hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT plugin_catalog_plugin_chk CHECK (plugin ~ '^[a-z_]+$'),
  CONSTRAINT plugin_catalog_status_chk CHECK (status IN ('pending', 'approved', 'withdrawn')),
  CONSTRAINT plugin_catalog_approval_chk CHECK (status = 'pending' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT plugin_catalog_conformance_chk CHECK (conformance->>'result' = 'passed'),
  -- A grant names every §4.1 class (src/shared/pluginGrant.ts checks the rest).
  CONSTRAINT plugin_catalog_capabilities_chk
    CHECK (jsonb_typeof(capabilities) = 'object' AND capabilities ?& array['activities', 'state', 'adapters', 'network', 'identity', 'ui']),
  CONSTRAINT plugin_catalog_entry_unique UNIQUE (package, version, hash)
);

COMMENT ON TABLE plugin_catalog IS
  'The console''s catalog of vetted plugin packages (ADR-014). Platform data. A row is one package version with the content hash of its files; the loader mounts a package only when an approved row records its hash. Written by catalog:add migrations (pending) and the console (approve, withdraw).';
COMMENT ON COLUMN plugin_catalog.hash IS
  'sha256 over the package''s files (src/plugins/hash.ts), as the conformance run saw them.';
COMMENT ON COLUMN plugin_catalog.capabilities IS
  'The grant recorded at approval: the package''s §4.1 capabilities, as its manifest declared them.';
COMMENT ON COLUMN plugin_catalog.conformance IS
  '{result, ran_at, commit, walked}: the conformance run that let the row be written. Only a passing run writes one.';

ALTER TABLE plugin_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_catalog FORCE ROW LEVEL SECURITY;

-- 2. A hub's installs ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hub_plugins (
  hub_id              text        NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  package             text        NOT NULL,
  version             text        NOT NULL,
  plugin              text        NOT NULL,
  capabilities        jsonb       NOT NULL,
  installed_at        timestamptz NOT NULL DEFAULT now(),
  installed_by        text        NOT NULL,
  removed_at          timestamptz,
  removed_by          text,
  winding_down_since  timestamptz,
  winding_down_by     text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, package),
  CONSTRAINT hub_plugins_removed_chk CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  CONSTRAINT hub_plugins_winding_chk CHECK ((winding_down_since IS NULL) = (winding_down_by IS NULL))
);
CREATE INDEX IF NOT EXISTS hub_plugins_plugin_idx ON hub_plugins (hub_id, plugin);

COMMENT ON TABLE hub_plugins IS
  'Which version of each plugin package a hub installed and the grant it recorded (ADR-014). plugin.<id>.enabled stays the runtime gate; apply_plugin_change() writes both together.';
COMMENT ON COLUMN hub_plugins.installed_by IS
  'The admin''s account id, or system:<why> (system:shipped for the packages every hub had before plugin packages, system:hub-created for a new hub).';
COMMENT ON COLUMN hub_plugins.winding_down_since IS
  'Set while the plugin winds down: no new processes, open ones run to their close, then the close job turns it off.';

SELECT public._civic_apply_hub_policy('public.hub_plugins');

-- 3. An install, a removal or a wind-down, in one transaction ---------------------------
-- p_change: 'install' | 'stop' | 'wind_down' | 'wound_down'.
-- p_packages: [{package, version, capabilities}] for 'install' (the catalog's
--   approved rows, chosen by the server); ignored otherwise, where every
--   package of p_plugin on the hub is changed.
-- p_settings: [{key, value}] the hub settings that go with it, written as the
--   settings path writes them (the switch, the wind-down flag, the section
--   order). A key outside plugin.<p_plugin>.* and nav.section_order is refused.
CREATE OR REPLACE FUNCTION public.apply_plugin_change(
  p_hub_id text,
  p_plugin text,
  p_change text,
  p_packages jsonb,
  p_settings jsonb,
  p_actor text
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pkg jsonb;
  v_set jsonb;
  v_count integer := 0;
BEGIN
  IF p_change NOT IN ('install', 'stop', 'wind_down', 'wound_down') THEN
    RAISE EXCEPTION 'apply_plugin_change: unknown change %', p_change USING ERRCODE = '22023';
  END IF;
  IF p_actor IS NULL OR p_actor = '' THEN
    RAISE EXCEPTION 'apply_plugin_change: an actor is required' USING ERRCODE = '22023';
  END IF;

  FOR v_set IN SELECT * FROM jsonb_array_elements(coalesce(p_settings, '[]'::jsonb)) LOOP
    IF NOT (v_set->>'key' LIKE 'plugin.' || p_plugin || '.%' OR v_set->>'key' = 'nav.section_order') THEN
      RAISE EXCEPTION 'apply_plugin_change: % is not plugin %''s setting', v_set->>'key', p_plugin USING ERRCODE = '22023';
    END IF;
    IF v_set->>'value' IS NULL THEN
      DELETE FROM hub_settings WHERE hub_id = p_hub_id AND key = v_set->>'key';
    ELSE
      INSERT INTO hub_settings (hub_id, key, value, updated_by)
      VALUES (p_hub_id, v_set->>'key', v_set->>'value', p_actor)
      ON CONFLICT (hub_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by;
    END IF;
  END LOOP;

  IF p_change = 'install' THEN
    FOR v_pkg IN SELECT * FROM jsonb_array_elements(coalesce(p_packages, '[]'::jsonb)) LOOP
      INSERT INTO hub_plugins (hub_id, package, version, plugin, capabilities, installed_at, installed_by)
      VALUES (p_hub_id, v_pkg->>'package', v_pkg->>'version', p_plugin, v_pkg->'capabilities', now(), p_actor)
      ON CONFLICT (hub_id, package) DO UPDATE SET
        version = EXCLUDED.version,
        plugin = EXCLUDED.plugin,
        capabilities = EXCLUDED.capabilities,
        installed_at = now(),
        installed_by = EXCLUDED.installed_by,
        removed_at = NULL,
        removed_by = NULL,
        winding_down_since = NULL,
        winding_down_by = NULL,
        updated_at = now();
      v_count := v_count + 1;
    END LOOP;
  ELSIF p_change = 'wind_down' THEN
    UPDATE hub_plugins SET winding_down_since = now(), winding_down_by = p_actor, updated_at = now()
     WHERE hub_id = p_hub_id AND plugin = p_plugin AND removed_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    UPDATE hub_plugins SET removed_at = now(), removed_by = p_actor,
           winding_down_since = NULL, winding_down_by = NULL, updated_at = now()
     WHERE hub_id = p_hub_id AND plugin = p_plugin AND removed_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.apply_plugin_change(text, text, text, jsonb, jsonb, text) IS
  'Install, stop, wind down or finish winding down one plugin on a hub: its hub_plugins rows and its plugin settings in one transaction (ADR-014). Called through forHub().rpc() by src/services/pluginInstall.ts.';

-- 4. A new hub gets every approved package ------------------------------------------------
CREATE OR REPLACE FUNCTION public._civic_install_approved_plugins(p_hub_id text, p_actor text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO hub_plugins (hub_id, package, version, plugin, capabilities, installed_at, installed_by)
  SELECT p_hub_id, c.package, c.version, c.plugin, c.capabilities, now(), p_actor
    FROM (
      SELECT DISTINCT ON (package) package, version, plugin, capabilities
        FROM plugin_catalog
       WHERE status = 'approved'
       ORDER BY package, approved_at DESC, created_at DESC
    ) c
  ON CONFLICT (hub_id, package) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public._civic_install_approved_plugins(text, text) IS
  'Record every approved catalog package (its newest approved version) as installed on one hub; existing rows are left alone. SECURITY DEFINER: it reads the platform catalog, which no hub role may.';

CREATE OR REPLACE FUNCTION public._civic_hub_plugins_on_new_hub()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._civic_install_approved_plugins(NEW.id, 'system:hub-created');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hubs_install_approved_plugins ON hubs;
CREATE TRIGGER hubs_install_approved_plugins
  AFTER INSERT ON hubs
  FOR EACH ROW EXECUTE FUNCTION public._civic_hub_plugins_on_new_hub();

-- A change to a hub's installs reaches every server on its next request, as a
-- settings change does.
DROP TRIGGER IF EXISTS hub_plugins_bump_version ON hub_plugins;
CREATE TRIGGER hub_plugins_bump_version
  AFTER INSERT OR UPDATE OR DELETE ON hub_plugins
  FOR EACH ROW EXECUTE FUNCTION public._civic_bump_settings_version();

-- 5. Grants ----------------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON plugin_catalog FROM authenticated;
    REVOKE ALL ON hub_plugins FROM authenticated;
    GRANT SELECT, INSERT, UPDATE ON hub_plugins TO authenticated;
    GRANT EXECUTE ON FUNCTION public.apply_plugin_change(text, text, text, jsonb, jsonb, text) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- No DELETE on the catalog: a row is withdrawn, never removed.
    GRANT SELECT, INSERT, UPDATE ON plugin_catalog TO service_role;
    -- DELETE for a hub's purge.
    GRANT SELECT, INSERT, UPDATE, DELETE ON hub_plugins TO service_role;
    GRANT EXECUTE ON FUNCTION public.apply_plugin_change(text, text, text, jsonb, jsonb, text) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON plugin_catalog FROM anon;
    REVOKE ALL ON hub_plugins FROM anon;
    REVOKE ALL ON FUNCTION public.apply_plugin_change(text, text, text, jsonb, jsonb, text) FROM anon;
  END IF;
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_install_approved_plugins(text, text) FROM %I', r);
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_hub_plugins_on_new_hub() FROM %I', r);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.apply_plugin_change(text, text, text, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_install_approved_plugins(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_hub_plugins_on_new_hub() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
