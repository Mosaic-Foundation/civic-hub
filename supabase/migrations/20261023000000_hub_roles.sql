-- Roles as claims keyed by the account (Architecture 4, ADR-011). Additive: one
-- table, seven functions, four triggers, one backfill. No existing row
-- changes, and nothing the code reads today is touched.
--
-- Until now a hub's roles were email addresses in hub_settings
-- (people.admin_emails, people.board_emails, people.announcement_authors), and
-- every check compared the caller's address with a list. From this release the
-- checks read hub_roles, keyed by the account (users.id), so a person can hold
-- a role whatever they signed in with.
--
-- THE LISTS STAY THE INPUT (Adam, Q1). The console, the admin panel, the seed
-- scripts and hub import keep writing the same settings rows; a trigger turns
-- them into hub_roles rows in the same transaction, so the two cannot drift
-- and old code (which reads the lists) keeps working on a migrated database.
-- The app never writes hub_roles: the authenticated role may only read it.
--
--   hub_roles          one row per grant: a role named by a list entry
--                      (source 'people_list', granted_email), bound to the
--                      account with that address (user_id), or PENDING
--                      (user_id null) while no account has it (Q2). A check
--                      reads user_id only; a pending grant authorizes nobody.
--                      attrs carries an announcement author's label and name.
--   _civic_js_trim     JavaScript's String.prototype.trim, so the lists are
--                      read here exactly as asList() reads them.
--   _civic_settings_list   asList(): a JSON array of strings, else a comma list.
--   _civic_people_grants   the rows the lists call for, each bound to the
--                      accounts with its address or pending.
--   _civic_sync_hub_roles  recomputes one hub's 'people_list' grants from its
--                      settings and accounts; deletes what is no longer
--                      granted, inserts what is missing, leaves the rest.
--                      Running it twice changes nothing (idempotent).
--   triggers           on hub_settings (the three people keys and the legacy
--                      announcement_authors key) and on users (a new account,
--                      a changed address, a removed account) call the sync; a change to hub_roles
--                      bumps hubs.settings_version, so every server's cached
--                      roles reload on their next request.
--
-- Parity with the code it replaces, rule by rule:
--   admin               asEmailList(resolve(people.admin_emails)): no alias
--   board               asEmailList(resolve(people.board_emails)): no alias
--   announcement_author getAnnouncementAuthors(): the stored list (key or its
--                       alias) when it parses as a JSON array of objects,
--                       normalized as normalizeAuthors() does; otherwise
--                       every board address labelled "Board member"
--   a value of '' reads as unset (resolve()); an account matches a grant when
--   lower(users.email) equals the granted address (isAdminEmail lowercases).
--
-- The one-time coverage check (scripts/check-hub-roles.ts) compares these rows
-- with the lists as the app parses them, per hub, before any check switches.
--
-- SECURITY DEFINER on the sync and trigger functions: they write hub_roles,
-- which the hub's own token may not, and read only the hub named by the row
-- that fired them. Every role's EXECUTE is revoked. Never raises 40001.

-- 1. The table ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hub_roles (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  hub_id         text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('admin', 'board', 'announcement_author')),
  user_id        text NULL,
  source         text NOT NULL DEFAULT 'people_list' CHECK (source IN ('people_list')),
  granted_email  text NULL CHECK (granted_email IS NULL OR (granted_email = lower(granted_email) AND length(granted_email) > 0)),
  attrs          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hub_roles_user_fkey FOREIGN KEY (hub_id, user_id) REFERENCES users (hub_id, id) ON DELETE CASCADE,
  CONSTRAINT hub_roles_list_names_address CHECK (source <> 'people_list' OR granted_email IS NOT NULL)
);
-- One row per (grant, account); one pending row per grant with no account.
CREATE UNIQUE INDEX IF NOT EXISTS hub_roles_grant_idx
  ON hub_roles (hub_id, role, source, granted_email, coalesce(user_id, ''));
CREATE INDEX IF NOT EXISTS hub_roles_user_idx ON hub_roles (hub_id, user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE hub_roles IS
  'Who holds which hub role, by account (ADR-011). Written only by trigger from the people.* settings (source people_list). A row with user_id null is a pending grant: an address with no account yet; it authorizes nobody.';
COMMENT ON COLUMN hub_roles.granted_email IS
  'The address the people list named, lowercased. Kept so the trigger can bind the grant when an account with this address appears; never read by an authorization check.';
COMMENT ON COLUMN hub_roles.attrs IS
  'For announcement_author: {label, name?} as the list gave them (the board fallback labels "Board member").';

SELECT public._civic_apply_hub_policy('public.hub_roles');

-- 2. Reading the lists as the app does ---------------------------------------------
CREATE OR REPLACE FUNCTION public._civic_js_trim(v text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(
    v,
    E'^[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+|[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+$',
    '', 'g')
$$;

CREATE OR REPLACE FUNCTION public._civic_settings_list(v text)
RETURNS TABLE (item text, ord bigint)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  t text := _civic_js_trim(coalesce(v, ''));
  parsed jsonb;
BEGIN
  IF t = '' THEN RETURN; END IF;
  IF left(t, 1) = '[' THEN
    BEGIN
      parsed := t::jsonb;
    EXCEPTION WHEN others THEN
      parsed := NULL;
    END;
    IF parsed IS NOT NULL AND jsonb_typeof(parsed) = 'array' THEN
      RETURN QUERY
        SELECT x.s, x.n FROM (
          SELECT _civic_js_trim(CASE WHEN jsonb_typeof(e.value) = 'string' THEN e.value #>> '{}' ELSE '' END) AS s, e.n
            FROM jsonb_array_elements(parsed) WITH ORDINALITY AS e(value, n)
        ) x
        WHERE x.s <> ''
        ORDER BY x.n;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY
    SELECT x.s, x.n FROM (
      SELECT _civic_js_trim(p.part) AS s, p.n
        FROM regexp_split_to_table(t, ',') WITH ORDINALITY AS p(part, n)
    ) x
    WHERE x.s <> ''
    ORDER BY x.n;
END;
$$;

-- 3. One hub's grants, as the lists say they should be ------------------------------
-- Each grant (role, address) the hub's people settings make, bound to every
-- account on the hub whose lowercased address matches it, or one pending row
-- (user_id null) when none does.
CREATE OR REPLACE FUNCTION public._civic_people_grants(p_hub_id text)
RETURNS TABLE (role text, granted_email text, user_id text, attrs jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admins text;
  v_board text;
  v_authors text;
  parsed jsonb;
  use_list boolean := false;
BEGIN
  SELECT nullif(s.value, '') INTO v_admins FROM hub_settings s WHERE s.hub_id = p_hub_id AND s.key = 'people.admin_emails';
  SELECT nullif(s.value, '') INTO v_board FROM hub_settings s WHERE s.hub_id = p_hub_id AND s.key = 'people.board_emails';
  SELECT coalesce(
           (SELECT nullif(s.value, '') FROM hub_settings s WHERE s.hub_id = p_hub_id AND s.key = 'people.announcement_authors'),
           (SELECT nullif(s.value, '') FROM hub_settings s WHERE s.hub_id = p_hub_id AND s.key = 'announcement_authors'))
    INTO v_authors;

  -- getAnnouncementAuthors(): the stored list only when it is a JSON array
  -- whose every element is an object (to JavaScript, null and arrays are too).
  IF v_authors IS NOT NULL THEN
    BEGIN
      parsed := v_authors::jsonb;
    EXCEPTION WHEN others THEN
      parsed := NULL;
    END;
    use_list := parsed IS NOT NULL AND jsonb_typeof(parsed) = 'array'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(parsed) e WHERE jsonb_typeof(e) NOT IN ('object', 'array', 'null'));
  END IF;

  RETURN QUERY
  WITH wanted AS (
    -- admin and board: asEmailList (lowercased, deduplicated).
    SELECT DISTINCT 'admin'::text AS role, lower(l.item) AS granted_email, '{}'::jsonb AS attrs
      FROM _civic_settings_list(v_admins) l
    UNION ALL
    SELECT DISTINCT 'board'::text, lower(l.item), '{}'::jsonb
      FROM _civic_settings_list(v_board) l
    UNION ALL
    -- announcement_author: normalizeAuthors() over the list (first entry per
    -- address wins), or every board address labelled "Board member".
    SELECT * FROM (
      SELECT DISTINCT ON (lower(a.email)) 'announcement_author'::text, lower(a.email),
             CASE WHEN a.name <> '' THEN jsonb_build_object('label', a.label, 'name', a.name)
                  ELSE jsonb_build_object('label', a.label) END
        FROM (
          SELECT _civic_js_trim(CASE WHEN jsonb_typeof(e.value -> 'email') = 'string' THEN e.value ->> 'email' ELSE '' END) AS email,
                 _civic_js_trim(CASE WHEN jsonb_typeof(e.value -> 'name') = 'string' THEN e.value ->> 'name' ELSE '' END) AS name,
                 _civic_js_trim(CASE WHEN jsonb_typeof(e.value -> 'label') = 'string' THEN e.value ->> 'label' ELSE '' END) AS label,
                 e.n
            FROM jsonb_array_elements(CASE WHEN use_list THEN parsed ELSE '[]'::jsonb END) WITH ORDINALITY AS e(value, n)
           WHERE jsonb_typeof(e.value) = 'object'
        ) a
       WHERE a.email <> '' AND a.label <> ''
       ORDER BY lower(a.email), a.n
    ) listed
    UNION ALL
    SELECT * FROM (
      SELECT DISTINCT ON (lower(l.item)) 'announcement_author'::text, lower(l.item), jsonb_build_object('label', 'Board member')
        FROM _civic_settings_list(CASE WHEN use_list THEN NULL ELSE v_board END) l
       ORDER BY lower(l.item), l.ord
    ) fallback
  )
  SELECT w.role, w.granted_email, u.id, w.attrs
    FROM wanted w
    LEFT JOIN users u ON u.hub_id = p_hub_id AND u.email IS NOT NULL AND lower(u.email) = w.granted_email;
END;
$$;

COMMENT ON FUNCTION public._civic_people_grants(text) IS
  'The hub_roles rows one hub''s people.* settings and accounts call for (ADR-011). Read by _civic_sync_hub_roles only.';

-- Make hub_roles say what _civic_people_grants says, touching only what
-- differs. One sync per hub at a time (an advisory lock for the transaction),
-- so two sign-ups binding the same grant cannot interleave.
CREATE OR REPLACE FUNCTION public._civic_sync_hub_roles(p_hub_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_hub_id IS NULL OR NOT EXISTS (SELECT 1 FROM hubs WHERE id = p_hub_id) THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('civic-hub-roles:' || p_hub_id, 0));

  DELETE FROM hub_roles r
   WHERE r.hub_id = p_hub_id AND r.source = 'people_list'
     AND NOT EXISTS (
       SELECT 1 FROM _civic_people_grants(p_hub_id) w
        WHERE w.role = r.role AND w.granted_email = r.granted_email
          AND w.user_id IS NOT DISTINCT FROM r.user_id AND w.attrs = r.attrs);

  INSERT INTO hub_roles (hub_id, role, user_id, source, granted_email, attrs)
  SELECT p_hub_id, w.role, w.user_id, 'people_list', w.granted_email, w.attrs
    FROM _civic_people_grants(p_hub_id) w
  ON CONFLICT (hub_id, role, source, granted_email, coalesce(user_id, '')) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public._civic_sync_hub_roles(text) IS
  'Recompute one hub''s people_list grants in hub_roles. Idempotent: a second run changes nothing. Called by trigger and by the backfill only (ADR-011).';

-- 4. Triggers ----------------------------------------------------------------------
-- A settings row for one of the four people keys (the authors list has a
-- legacy name) was written or removed. Checked in the function rather than a
-- WHEN clause, which cannot read OLD on INSERT nor NEW on DELETE.
CREATE OR REPLACE FUNCTION public._civic_hub_roles_from_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  people constant text[] := ARRAY['people.admin_emails', 'people.board_emails', 'people.announcement_authors', 'announcement_authors'];
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.key = ANY (people) THEN
    PERFORM _civic_sync_hub_roles(OLD.hub_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.key = ANY (people)
     AND (TG_OP = 'INSERT' OR NEW.hub_id IS DISTINCT FROM OLD.hub_id OR NOT (OLD.key = ANY (people))) THEN
    PERFORM _civic_sync_hub_roles(NEW.hub_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS hub_settings_people_roles ON hub_settings;
CREATE TRIGGER hub_settings_people_roles
  AFTER INSERT OR UPDATE OR DELETE ON hub_settings
  FOR EACH ROW
  EXECUTE FUNCTION public._civic_hub_roles_from_settings();

-- An account appears or changes its address: bind or unbind the grants that
-- name the address. Only when a grant names it, so a sign-up costs one index
-- probe.
CREATE OR REPLACE FUNCTION public._civic_hub_roles_from_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.email IS NOT DISTINCT FROM OLD.email AND NEW.hub_id IS NOT DISTINCT FROM OLD.hub_id THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM hub_roles r
     WHERE r.hub_id = OLD.hub_id AND r.source = 'people_list'
       AND (r.granted_email = lower(OLD.email) OR r.user_id = OLD.id))
  THEN
    PERFORM _civic_sync_hub_roles(OLD.hub_id);
  END IF;
  IF EXISTS (
    SELECT 1 FROM hub_roles r
     WHERE r.hub_id = NEW.hub_id AND r.source = 'people_list' AND r.granted_email = lower(NEW.email))
  THEN
    PERFORM _civic_sync_hub_roles(NEW.hub_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS users_bind_hub_roles ON users;
CREATE TRIGGER users_bind_hub_roles
  AFTER INSERT OR UPDATE OF email, hub_id ON users
  FOR EACH ROW
  EXECUTE FUNCTION public._civic_hub_roles_from_users();

-- Accounts went: the foreign key has already removed their bound grants, so
-- an address the lists still name pends again. Once per statement, after the
-- cascade (a statement-level AFTER trigger runs after every row's), and once
-- per hub however many accounts the statement removed (a purge, a sample
-- removal).
CREATE OR REPLACE FUNCTION public._civic_hub_roles_after_users_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE h text;
BEGIN
  FOR h IN
    SELECT DISTINCT g.hub_id FROM gone g
     WHERE g.email IS NOT NULL
       AND EXISTS (SELECT 1 FROM _civic_people_grants(g.hub_id) w WHERE w.granted_email = lower(g.email))
  LOOP
    PERFORM _civic_sync_hub_roles(h);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS users_gone_hub_roles ON users;
CREATE TRIGGER users_gone_hub_roles
  AFTER DELETE ON users
  REFERENCING OLD TABLE AS gone
  FOR EACH STATEMENT
  EXECUTE FUNCTION public._civic_hub_roles_after_users_delete();

-- A change to anyone's roles reaches every server's cached copy on its next
-- request (the same version the settings cache goes by).
DROP TRIGGER IF EXISTS hub_roles_bump_version ON hub_roles;
CREATE TRIGGER hub_roles_bump_version
  AFTER INSERT OR UPDATE OR DELETE ON hub_roles
  FOR EACH ROW EXECUTE FUNCTION public._civic_bump_settings_version();

-- 5. Backfill: every hub, once. Running this file again changes nothing. ---------
DO $$
DECLARE h text;
BEGIN
  FOR h IN SELECT id FROM hubs ORDER BY id LOOP
    PERFORM public._civic_sync_hub_roles(h);
  END LOOP;
END $$;

-- 6. Grants ----------------------------------------------------------------------
-- The hub reads hub_roles under its token; only the triggers write it.
DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON hub_roles FROM authenticated;
    GRANT SELECT ON hub_roles TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON hub_roles FROM service_role;
    GRANT SELECT ON hub_roles TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON hub_roles FROM anon;
  END IF;
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_js_trim(text) FROM %I', r);
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_settings_list(text) FROM %I', r);
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_people_grants(text) FROM %I', r);
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_sync_hub_roles(text) FROM %I', r);
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_hub_roles_from_settings() FROM %I', r);
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_hub_roles_from_users() FROM %I', r);
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_hub_roles_after_users_delete() FROM %I', r);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public._civic_js_trim(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_settings_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_people_grants(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_sync_hub_roles(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_hub_roles_from_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_hub_roles_from_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_hub_roles_after_users_delete() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
