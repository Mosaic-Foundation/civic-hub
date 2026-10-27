-- The Events plugin's tables. Additive (three new tables), each under the
-- hub's row-level security template and granted to the hub's roles, like
-- every hub table.
--
--   calendar_events      the hub's calendar: one row per published event,
--                        what the calendar and its .ics export list (the event
--                        itself is its process; this is its index by date)
--   calendar_attendance  who said they are going, one row each
--   calendar_drafts      residents' unfinished event drafts (the hub's drafts
--                        routes, Code of Conduct check and review queue)

CREATE TABLE IF NOT EXISTS public.calendar_events (
  hub_id       text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  process_id   text        NOT NULL,
  title        text        NOT NULL,
  description  text        NOT NULL DEFAULT '',
  start_time   timestamptz NOT NULL,
  end_time     timestamptz NOT NULL,
  location     jsonb       NOT NULL,
  cancelled    boolean     NOT NULL DEFAULT false,
  archived     boolean     NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, process_id)
);

CREATE INDEX IF NOT EXISTS calendar_events_hub_start_idx ON public.calendar_events (hub_id, start_time);

CREATE TABLE IF NOT EXISTS public.calendar_attendance (
  hub_id     text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  process_id text        NOT NULL,
  user_id    text        NOT NULL,
  going_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, process_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.calendar_drafts (
  id                          text        PRIMARY KEY,
  hub_id                      text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  user_id                     text        NOT NULL,
  title                       text        NOT NULL DEFAULT '',
  description                 text        NOT NULL DEFAULT '',
  sources                     text        NOT NULL DEFAULT '',
  start_time                  timestamptz,
  end_time                    timestamptz,
  venue                       text,
  street_address              text,
  locality                    text,
  region                      text,
  postal_code                 text,
  country                     text,
  online_url                  text,
  conversation_history        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  last_review_result          jsonb,
  draft_modified_since_review boolean     NOT NULL DEFAULT false,
  coc_checked_hash            text,
  assistant_helped            boolean     NOT NULL DEFAULT false,
  links                       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status                      text        NOT NULL DEFAULT 'drafting',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_drafts_hub_user_status_idx ON public.calendar_drafts (hub_id, user_id, status);

CREATE TRIGGER set_calendar_drafts_updated_at
  BEFORE UPDATE ON public.calendar_drafts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.calendar_events IS
  'The Events plugin''s calendar: one row per published event, indexed by date for the calendar and its .ics export.';
COMMENT ON TABLE public.calendar_attendance IS
  'The Events plugin''s attendance: one row per resident going to an event; the count is public, names follow the members policy.';
COMMENT ON TABLE public.calendar_drafts IS
  'The Events plugin''s drafts: residents'' unfinished events, submitted through the hub''s review.';

SELECT public._civic_apply_hub_policy('public.calendar_events');
SELECT public._civic_apply_hub_policy('public.calendar_attendance');
SELECT public._civic_apply_hub_policy('public.calendar_drafts');

-- Granted to the hub's roles here, as every hub migration does: a local or CI
-- stack gives a new table no privileges by default (20260922000000).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_events TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_attendance TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_drafts TO authenticated, service_role;
  END IF;
END $$;
