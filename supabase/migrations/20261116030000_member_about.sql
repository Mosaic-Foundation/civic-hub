-- Districts and demographics (Adam, 2026-11-16): "About you", what a member
-- may tell the hub about themselves, each answer optional.
--
--   member_about   one row per member who has been asked: their district
--                  (an id from the hub's about.districts setting), year of
--                  birth, race (only if the hub asks), the questions they
--                  answered "Prefer not to say", and when they were first
--                  asked, so the one-time card never shows again.
--
-- Visible only to the member (Settings > About you). Admins never see one
-- person's answers; results read them only as totals of five or more
-- (src/services/breakdowns.ts). Deleted with the account (the foreign key
-- cascades from users). Moves with the hub in an export, like users.
--
-- Additive: one new table, forced RLS by the hub template, like every hub
-- table. Applies twice without error.

CREATE TABLE IF NOT EXISTS member_about (
  hub_id       text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  user_id      text NOT NULL,
  district_id  text NULL CHECK (district_id IS NULL OR district_id ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  birth_year   integer NULL CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  race         text[] NOT NULL DEFAULT '{}' CHECK (cardinality(race) <= 8),
  declined     text[] NOT NULL DEFAULT '{}' CHECK (declined <@ ARRAY['district', 'birth_year', 'race']::text[]),
  asked_at     timestamptz NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, user_id),
  CONSTRAINT member_about_user_fkey FOREIGN KEY (hub_id, user_id) REFERENCES users (hub_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE member_about IS
  'A member''s own About-you answers (district, birth year, race if the hub asks), each optional, and when they were first asked. Seen only by the member; results use them only as totals of five or more. Deleted with the account.';
COMMENT ON COLUMN member_about.district_id IS
  'An id from the hub''s about.districts setting (kept when a district is renamed). NULL: not given.';
COMMENT ON COLUMN member_about.declined IS
  'The questions the member answered "Prefer not to say". Counted as not provided, like an empty answer.';
COMMENT ON COLUMN member_about.asked_at IS
  'When the member was first asked. Set once, by the one-time card or Settings; the card never shows again.';

SELECT public._civic_apply_hub_policy('public.member_about');

DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('authenticated', 'service_role') LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_about TO %I', r);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.member_about FROM anon;
  END IF;
END $$;
