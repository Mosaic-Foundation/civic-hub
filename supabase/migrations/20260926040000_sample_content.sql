-- Phase 7: sample content for new hubs, and the hub admin audit log.
-- Contract: BUILD-PLAN-multi-tenant.md → "Phase 7 — Sample content for new
-- hubs". Additive: three columns with defaults, triggers, one new table.
--
-- 1. THE MARKER. `is_sample boolean not null default false` on processes,
--    events and users. A column rather than a field in process state: the
--    readers that must leave sample content out (/events, federation, the
--    export, the resident digest) and the removal all filter it in SQL, and
--    an event has no process state to carry it. Child rows (ballots,
--    comments, supports, updates, links, submissions) are not marked; they
--    are found through their sample process_id.
--
-- 2. THE DATABASE STAMPS IT, so nothing depends on every writer remembering:
--    - an event whose process is a sample process is a sample event, whoever
--      emitted it — the seed, the hourly vote_close job, or a real resident
--      voting on a sample vote. Sample events are illustrative, not public
--      record, so a real person's action on one must not reach /events.
--    - a process spawned from a sample process (a brief or results page from
--      a closed sample vote; a vote converted from a sample proposal) is a
--      sample process. Spawns name their source in state.source_process_id
--      or source_proposal_id; the trigger reads both.
--    Both triggers only ever turn the flag ON; the seed sets it directly.
--
-- 3. EVENTS STAY APPEND-ONLY FOR THE HUB APP. `events` has refused UPDATE
--    since 20260416000100; DELETE was left open for dev resets. Now a DELETE
--    by the hub-token role (`authenticated` — what the hub app runs as with
--    hub tokens on) is refused unless the row is a sample event, so removing
--    sample content works and nothing else can take a real event out of the
--    log. The service role and the owner are unaffected — the same boundary
--    RLS draws (both have BYPASSRLS): operator scripts, restore and test
--    cleanup keep working. (Adam, 2026-09-26, Q6.)
--
-- 4. hub_admin_audit_log: every hub-admin action that takes a fresh emailed
--    code — sample-content removal, mode changes, admin and board roster
--    changes. Hub-scoped (hub_id, forced RLS, the hub_isolation policy),
--    append-only for every role, exported with the hub. The console reads it
--    through the control plane; nothing is mirrored into control_audit_log.

-- 1. The marker -------------------------------------------------------------

ALTER TABLE processes ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE events    ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN processes.is_sample IS
  'Seeded sample content (Phase 7). Shown with a Sample badge; kept out of /events, federation, the export and resident digests; removable in one action.';
COMMENT ON COLUMN events.is_sample IS
  'Set by trigger from the event''s process. Sample events are illustrative, not public record: never served on /events or federated.';
COMMENT ON COLUMN users.is_sample IS
  'A synthetic author created by the sample-content seed. Removed with the sample content.';

-- Partial indexes: sample rows are few, and every hot read asks for the rest.
CREATE INDEX IF NOT EXISTS processes_hub_sample_idx ON processes (hub_id) WHERE is_sample;
CREATE INDEX IF NOT EXISTS events_hub_sample_idx    ON events (hub_id)    WHERE is_sample;
CREATE INDEX IF NOT EXISTS users_hub_sample_idx     ON users (hub_id)     WHERE is_sample;

-- 2. Stamping -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._civic_event_inherit_sample()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT NEW.is_sample AND NEW.process_id IS NOT NULL THEN
    NEW.is_sample := EXISTS (
      SELECT 1 FROM processes p
       WHERE p.hub_id = NEW.hub_id AND p.id = NEW.process_id AND p.is_sample
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_inherit_sample ON events;
CREATE TRIGGER events_inherit_sample
  BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION public._civic_event_inherit_sample();

CREATE OR REPLACE FUNCTION public._civic_process_inherit_sample()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sources text[];
BEGIN
  IF NEW.is_sample THEN
    RETURN NEW;
  END IF;
  v_sources := array_remove(ARRAY[
    NEW.source_proposal_id,
    NEW.state->>'source_process_id',
    NEW.state->>'source_proposal_id'
  ], NULL);
  IF array_length(v_sources, 1) IS NOT NULL THEN
    NEW.is_sample := EXISTS (
      SELECT 1 FROM processes p
       WHERE p.hub_id = NEW.hub_id AND p.id = ANY (v_sources) AND p.is_sample
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS processes_inherit_sample ON processes;
CREATE TRIGGER processes_inherit_sample
  BEFORE INSERT ON processes
  FOR EACH ROW EXECUTE FUNCTION public._civic_process_inherit_sample();

-- 3. Events: the hub app may delete sample events only ------------------------

CREATE OR REPLACE FUNCTION public._civic_events_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated' AND NOT OLD.is_sample THEN
    RAISE EXCEPTION 'events is append-only: only sample events may be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS events_delete_guard ON events;
CREATE TRIGGER events_delete_guard
  BEFORE DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION public._civic_events_delete_guard();

-- 4. hub_admin_audit_log ------------------------------------------------------

CREATE TABLE IF NOT EXISTS hub_admin_audit_log (
  -- A uuid, not an identity: the hub import writes rows with their ids, and
  -- a uuid cannot collide with another hub's rows on the target.
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  hub_id      TEXT NOT NULL REFERENCES hubs(id) ON DELETE RESTRICT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  before      JSONB NULL,
  after       JSONB NULL
);

CREATE INDEX IF NOT EXISTS hub_admin_audit_log_hub_at_idx ON hub_admin_audit_log (hub_id, at DESC);

COMMENT ON TABLE hub_admin_audit_log IS
  'Every hub-admin action that takes a fresh emailed code: sample-content removal, mode changes, roster changes. Hub data (exported); append-only (trigger). The console reads it through the control plane.';

CREATE OR REPLACE FUNCTION public._hub_admin_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'hub_admin_audit_log is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS hub_admin_audit_log_append_only ON hub_admin_audit_log;
CREATE TRIGGER hub_admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON hub_admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public._hub_admin_audit_log_append_only();

SELECT public._civic_apply_hub_policy('public.hub_admin_audit_log');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT ON hub_admin_audit_log TO authenticated, service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON hub_admin_audit_log FROM anon;
  END IF;
END $$;
