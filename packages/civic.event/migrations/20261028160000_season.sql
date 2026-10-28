-- Events 0.3.0: a season of events. Additive: new nullable columns, one new
-- table, one new function and its trigger; every existing row reads as it
-- did (no picture, the hub's time zone, no limit).
--
--   calendar_events, calendar_drafts
--     image_url, image_alt  its picture (the hub's upload route stores it;
--                           Events 2, E1) and what it shows, for screen readers
--     time_zone             the IANA zone its times are given in; null reads
--                           as the hub's (identity.timezone)
--     capacity              how many may say they are going; null: no limit
--   calendar_announcements  what was sent to the people going: a message from
--                           the creator or an admin, or what changed (a time,
--                           a place, a cancellation), and how many it reached
--   calendar_attendance_capacity  refuses a "going" past the event's limit,
--                           one at a time under the event's row lock, so two
--                           people never take the last place at once. It
--                           raises SQLSTATE P0001 'event_full' (never 40001).

ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS image_alt text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS time_zone text;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS capacity integer CHECK (capacity IS NULL OR capacity > 0);

ALTER TABLE public.calendar_drafts ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.calendar_drafts ADD COLUMN IF NOT EXISTS image_alt text;
ALTER TABLE public.calendar_drafts ADD COLUMN IF NOT EXISTS time_zone text;
ALTER TABLE public.calendar_drafts ADD COLUMN IF NOT EXISTS capacity integer;

CREATE TABLE IF NOT EXISTS public.calendar_announcements (
  id          text        PRIMARY KEY,
  hub_id      text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  process_id  text        NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('announcement', 'change')),
  sender      text        NOT NULL,
  subject     text        NOT NULL,
  body        text        NOT NULL,
  recipients  integer     NOT NULL DEFAULT 0,
  sent        integer     NOT NULL DEFAULT 0,
  held_back   integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_announcements_hub_process_idx
  ON public.calendar_announcements (hub_id, process_id, created_at DESC);

COMMENT ON TABLE public.calendar_announcements IS
  'The Events plugin''s messages to the people going to an event (an announcement, or what changed), with how many each reached. Read by the people going and the hub''s admins; never exported as a list of who.';

SELECT public._civic_apply_hub_policy('public.calendar_announcements');

CREATE FUNCTION public.calendar_attendance_capacity() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  cap integer;
  going integer;
BEGIN
  SELECT capacity INTO cap
    FROM public.calendar_events
   WHERE hub_id = NEW.hub_id AND process_id = NEW.process_id
     FOR UPDATE;
  -- No limit, or they are going already (the key refuses the row; "already").
  IF cap IS NULL OR EXISTS (
    SELECT 1 FROM public.calendar_attendance
     WHERE hub_id = NEW.hub_id AND process_id = NEW.process_id AND user_id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO going
    FROM public.calendar_attendance
   WHERE hub_id = NEW.hub_id AND process_id = NEW.process_id;
  IF going >= cap THEN
    RAISE EXCEPTION 'event_full' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_attendance_capacity
  BEFORE INSERT ON public.calendar_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.calendar_attendance_capacity();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_announcements TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.calendar_attendance_capacity() TO authenticated, service_role;
  END IF;
END $$;
