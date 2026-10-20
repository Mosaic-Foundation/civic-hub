-- Wire identity frozen at emission (Architecture-1, ADR-008).
--
-- An activity's id, its process IRI and its actor IRI were built from the
-- hub's CURRENT hostname every time they were read, so a hub move rewrote
-- every identifier it had ever published. Now each identifier is minted on
-- the hostname the hub had when the thing it names came into being, and that
-- hostname is stored:
--
--   events.wire_hostname          the hub's hostname when the event was
--                                 inserted: the activity id, system actor and
--                                 audience IRIs, generator.url, and (on old
--                                 rows) the hub: namespace
--   processes.wire_hostname       when the process was created: its IRI
--   users.wire_hostname           when the account was created: its IRI
--   events.wire_process_hostname  copied from the event's process at insert
--   events.wire_actor_hostname    copied from the event's acting account at
--                                 insert (falls back to wire_hostname for
--                                 machinery, DIDs and anonymous)
--   events.wire_ns                the hub: namespace IRI; NULL on rows from
--                                 before this release, which keep the
--                                 per-origin `{origin}/ns#` they were served
--                                 with. New rows take the column default, the
--                                 one software-level namespace.
--
-- The copies make the serializer read one row and nothing else, so a
-- document stays a pure function of its row (determinism).
--
-- STAMPED BY THE DATABASE, ON INSERT. Triggers fill each column only when the
-- insert leaves it NULL, so every insert path is covered (appendEvent, the
-- atomic functions' _civic_insert_event, the seed, scripts) and an import
-- that carries the values keeps them. The hostname columns on processes and
-- users never change once set: an update keeps the old value. SECURITY
-- DEFINER because the hub inserts as `authenticated` under a minted hub
-- token and `hubs` (forced RLS, no policy) is not readable by that role; the
-- functions read only the row the inserted row names. Trigger functions get
-- no EXECUTE grant (20261012100000), so all three are revoked from every role.
--
-- BACKFILL: every existing row gets its hub's hostname as it is now, which is
-- exactly what the row is served with today, so no published identifier
-- changes. `events` refuses UPDATE (events_no_update); the trigger is disabled
-- for the one statement and re-enabled in the same transaction, the pattern
-- of 20260926030000. The processes and users updated_at / search / version
-- triggers are disabled the same way so the backfill changes nothing else.
--
-- Additive and safe to run twice: new nullable columns, a default, three
-- functions, five triggers, and a backfill of NULLs only. Old code does not
-- read the columns. Never raises.

BEGIN;

-- 1. Columns -------------------------------------------------------------------

ALTER TABLE processes ADD COLUMN IF NOT EXISTS wire_hostname text;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS wire_hostname text;
ALTER TABLE events    ADD COLUMN IF NOT EXISTS wire_hostname text;
ALTER TABLE events    ADD COLUMN IF NOT EXISTS wire_process_hostname text;
ALTER TABLE events    ADD COLUMN IF NOT EXISTS wire_actor_hostname text;
-- Added without a default so existing rows stay NULL (legacy namespace);
-- the default below applies to rows inserted from now on.
ALTER TABLE events    ADD COLUMN IF NOT EXISTS wire_ns text;
ALTER TABLE events    ALTER COLUMN wire_ns SET DEFAULT 'https://www.civic.social/ns/civic-hub#';

COMMENT ON COLUMN processes.wire_hostname IS
  'The hub''s hostname when this process was created; its IRI on the wire. Set by trigger, never changed (ADR-008).';
COMMENT ON COLUMN users.wire_hostname IS
  'The hub''s hostname when this account was created; its IRI on the wire. Set by trigger, never changed (ADR-008).';
COMMENT ON COLUMN events.wire_hostname IS
  'The hub''s hostname when this event was stored: the activity id and the hub-level IRIs it carries. Set by trigger (ADR-008).';
COMMENT ON COLUMN events.wire_process_hostname IS
  'The event''s process''s wire_hostname, copied at insert: the process IRI this activity carries (ADR-008).';
COMMENT ON COLUMN events.wire_actor_hostname IS
  'The acting account''s wire_hostname, copied at insert (wire_hostname for machinery): the actor IRI (ADR-008).';
COMMENT ON COLUMN events.wire_ns IS
  'The hub: extension namespace IRI this activity declares. NULL on rows from before 2026-10-20, which keep {origin}/ns# (ADR-008).';

-- 2. Stamping ------------------------------------------------------------------

-- processes and users: the hub's hostname at insert; kept on update.
CREATE OR REPLACE FUNCTION public._civic_stamp_wire_hostname()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.wire_hostname IS NOT NULL THEN
    NEW.wire_hostname := OLD.wire_hostname;
  ELSIF NEW.wire_hostname IS NULL THEN
    SELECT h.hostname INTO NEW.wire_hostname FROM hubs h WHERE h.id = NEW.hub_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS processes_stamp_wire_hostname ON processes;
CREATE TRIGGER processes_stamp_wire_hostname
  BEFORE INSERT OR UPDATE OF wire_hostname ON processes
  FOR EACH ROW EXECUTE FUNCTION public._civic_stamp_wire_hostname();

DROP TRIGGER IF EXISTS users_stamp_wire_hostname ON users;
CREATE TRIGGER users_stamp_wire_hostname
  BEFORE INSERT OR UPDATE OF wire_hostname ON users
  FOR EACH ROW EXECUTE FUNCTION public._civic_stamp_wire_hostname();

-- events: the hub's hostname now, and the process's and actor's.
CREATE OR REPLACE FUNCTION public._civic_event_stamp_wire()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id text;
BEGIN
  IF NEW.wire_hostname IS NULL THEN
    SELECT h.hostname INTO NEW.wire_hostname FROM hubs h WHERE h.id = NEW.hub_id;
  END IF;

  IF NEW.wire_process_hostname IS NULL AND NEW.process_id IS NOT NULL AND NEW.process_id <> '' THEN
    SELECT p.wire_hostname INTO NEW.wire_process_hostname
      FROM processes p WHERE p.hub_id = NEW.hub_id AND p.id = NEW.process_id;
  END IF;
  IF NEW.wire_process_hostname IS NULL THEN
    NEW.wire_process_hostname := NEW.wire_hostname;
  END IF;

  -- A participant: anything but machinery, a DID or anonymous (the same
  -- test as isParticipantActor in src/events/publicRedaction.ts).
  IF NEW.wire_actor_hostname IS NULL
     AND coalesce(btrim(NEW.actor), '') <> ''
     AND NEW.actor NOT LIKE 'did:%'
     AND NEW.actor NOT LIKE 'system:%'
     AND NEW.actor NOT IN ('system', 'anonymous') THEN
    actor_id := CASE WHEN NEW.actor LIKE 'user:%' THEN substr(NEW.actor, 6) ELSE NEW.actor END;
    SELECT u.wire_hostname INTO NEW.wire_actor_hostname
      FROM users u WHERE u.hub_id = NEW.hub_id AND u.id = actor_id;
  END IF;
  IF NEW.wire_actor_hostname IS NULL THEN
    NEW.wire_actor_hostname := NEW.wire_hostname;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_stamp_wire ON events;
CREATE TRIGGER events_stamp_wire
  BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION public._civic_event_stamp_wire();

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public._civic_stamp_wire_hostname() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public._civic_event_stamp_wire() FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._civic_stamp_wire_hostname() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._civic_event_stamp_wire() FROM PUBLIC;

-- 3. Backfill: today's hostname, which is what every row is served with now ----

ALTER TABLE processes DISABLE TRIGGER processes_updated_at;
ALTER TABLE processes DISABLE TRIGGER processes_search_doc_trigger;
ALTER TABLE processes DISABLE TRIGGER processes_version;
UPDATE processes p SET wire_hostname = h.hostname
  FROM hubs h WHERE h.id = p.hub_id AND p.wire_hostname IS NULL;
ALTER TABLE processes ENABLE TRIGGER processes_version;
ALTER TABLE processes ENABLE TRIGGER processes_search_doc_trigger;
ALTER TABLE processes ENABLE TRIGGER processes_updated_at;

ALTER TABLE users DISABLE TRIGGER users_updated_at;
UPDATE users u SET wire_hostname = h.hostname
  FROM hubs h WHERE h.id = u.hub_id AND u.wire_hostname IS NULL;
ALTER TABLE users ENABLE TRIGGER users_updated_at;

ALTER TABLE events DISABLE TRIGGER events_no_update;
UPDATE events e SET
  wire_hostname         = coalesce(e.wire_hostname, h.hostname),
  wire_process_hostname = coalesce(e.wire_process_hostname, h.hostname),
  wire_actor_hostname   = coalesce(e.wire_actor_hostname, h.hostname)
  FROM hubs h
 WHERE h.id = e.hub_id
   AND (e.wire_hostname IS NULL OR e.wire_process_hostname IS NULL OR e.wire_actor_hostname IS NULL);
ALTER TABLE events ENABLE TRIGGER events_no_update;

COMMIT;
