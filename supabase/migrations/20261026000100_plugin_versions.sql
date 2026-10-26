-- Versions and upgrades (plugin session 2, ADR-015). Additive: two columns on
-- plugin_catalog, three on hub_plugins, a new change ('upgrade') that
-- apply_plugin_change() accepts beside the four it had, and one new function.
-- No existing row changes; old code keeps working on a migrated database (it
-- never sends 'upgrade' and selects its own columns).
--
-- A deployment runs one version of each package for every hub (option B,
-- Adam 2026-10-26). What a hub records is the version whose grant its admin
-- approved: Update records the deployment's newer version and its grant, and
-- the hub's seams enforce the grant it recorded.
--
--   plugin_catalog.required      the operator marks a version required: every
--                                hub is moved to it when a server mounts it
--                                (apply_required_plugin_version), with a notice
--                                on the hub's Plugins page.
--   plugin_catalog.auto_install  false for an entry a new hub does not get
--                                (the developer guide's example package).
--   hub_plugins.upgraded_from / upgraded_at / upgraded_by
--                                the last update: from which version, when, by
--                                whom (an admin's account, or system:required).
--   apply_plugin_change(…, 'upgrade', packages, …)
--                                records each package's new version and grant
--                                on the hub; settings untouched.
--   apply_required_plugin_version(package, version, grant)
--                                moves every hub on an older version of the
--                                package to this one. Service role only.
--   _civic_install_approved_plugins (replaced) skips auto_install = false and
--                                picks each package's highest approved version.
--
-- Never raises 40001. Every new function's EXECUTE is granted explicitly.

ALTER TABLE plugin_catalog
  ADD COLUMN IF NOT EXISTS required     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_install boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN plugin_catalog.required IS
  'The operator marked this version required: every hub is moved to it when a server mounts it, with a notice on the Plugins page (ADR-015). Not signed: it can only move hubs to a version that is itself approved and signed.';
COMMENT ON COLUMN plugin_catalog.auto_install IS
  'false: a new hub does not get this package (the developer guide''s example). Installing it stays the hub admin''s choice where the deployment loads it.';

ALTER TABLE hub_plugins
  ADD COLUMN IF NOT EXISTS upgraded_from text,
  ADD COLUMN IF NOT EXISTS upgraded_at   timestamptz,
  ADD COLUMN IF NOT EXISTS upgraded_by   text;

COMMENT ON COLUMN hub_plugins.upgraded_by IS
  'Who made the last update: an admin''s account id, or system:required for a version Civic.Social marked required (ADR-015).';

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
  v_n integer;
BEGIN
  IF p_change NOT IN ('install', 'stop', 'wind_down', 'wound_down', 'upgrade') THEN
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
  ELSIF p_change = 'upgrade' THEN
    -- Only rows the hub has, at another version: the update is of what it installed.
    FOR v_pkg IN SELECT * FROM jsonb_array_elements(coalesce(p_packages, '[]'::jsonb)) LOOP
      UPDATE hub_plugins SET
        upgraded_from = version,
        version = v_pkg->>'version',
        capabilities = v_pkg->'capabilities',
        upgraded_at = now(),
        upgraded_by = p_actor,
        updated_at = now()
       WHERE hub_id = p_hub_id AND package = v_pkg->>'package' AND version IS DISTINCT FROM v_pkg->>'version';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_count := v_count + v_n;
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
  'Install, stop, wind down, finish winding down or update one plugin on a hub: its hub_plugins rows and its plugin settings in one transaction (ADR-014, ADR-015). Called through forHub().rpc() by src/services/pluginInstall.ts.';

-- Semver as an integer array, for ordering versions ("0.10.0" after "0.9.0").
CREATE OR REPLACE FUNCTION public._civic_semver(p_version text)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$' THEN string_to_array(p_version, '.')::integer[] ELSE ARRAY[0, 0, 0] END;
$$;

CREATE OR REPLACE FUNCTION public.apply_required_plugin_version(
  p_package text,
  p_version text,
  p_capabilities jsonb
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM plugin_catalog
     WHERE package = p_package AND version = p_version AND status = 'approved' AND required
  ) THEN
    RAISE EXCEPTION 'apply_required_plugin_version: % % is not an approved, required version', p_package, p_version USING ERRCODE = '22023';
  END IF;
  UPDATE hub_plugins SET
    upgraded_from = version,
    version = p_version,
    capabilities = p_capabilities,
    upgraded_at = now(),
    upgraded_by = 'system:required',
    updated_at = now()
   WHERE package = p_package AND public._civic_semver(version) < public._civic_semver(p_version);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.apply_required_plugin_version(text, text, jsonb) IS
  'Move every hub on an older version of a package to a required one (ADR-015): its version and grant, recorded as an update by system:required. Called by the loader when it mounts a required version. Service role only.';

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
       WHERE status = 'approved' AND auto_install
       ORDER BY package, public._civic_semver(version) DESC, approved_at DESC, created_at DESC
    ) c
  ON CONFLICT (hub_id, package) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public._civic_install_approved_plugins(text, text) IS
  'Record every approved catalog package a new hub gets (auto_install; its highest approved version) as installed on one hub; existing rows are left alone. SECURITY DEFINER: it reads the platform catalog, which no hub role may.';

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION public.apply_required_plugin_version(text, text, jsonb) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public._civic_semver(text) FROM %I', r);
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      GRANT EXECUTE ON FUNCTION public.apply_required_plugin_version(text, text, jsonb) TO service_role;
      GRANT EXECUTE ON FUNCTION public._civic_semver(text) TO service_role;
    END IF;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.apply_required_plugin_version(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_semver(text) FROM PUBLIC;
