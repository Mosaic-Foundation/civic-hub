-- job_runs: the outcome of each scheduled job, per hub (2026-09-29).
--
-- WHY. A job that fails, or succeeds while producing something an admin must
-- check, told nobody unless it happened to send an email: the 2026-09-22
-- meeting summary came out without video timestamps and every counter read
-- clean. Each hub job (src/jobs/registry.ts) now records one row per run that
-- did something, and two readers use them:
--
--   - the admin's plugin page shows a "last run" line per job: when it ran,
--     what it produced, any error;
--   - the admin digest lists every failed or flagged run since the last one.
--
-- Written only by the job runner (src/jobs/runJob.ts → src/services/jobRuns.ts)
-- through forHub(); pruned to the newest rows per job by the same writer.
--
-- Hub-scoped like every table: hub_id, forced RLS, the hub_isolation policy,
-- a hub-leading index. Additive only. Not in a hub's export: it is an
-- operational log of this host's runs, and the next host writes its own
-- (src/db/schemaContract.ts EXPORT_MANIFEST).

CREATE TABLE IF NOT EXISTS job_runs (
  -- A uuid, not an identity, like hub_admin_audit_log: never collides across hubs.
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  hub_id      TEXT NOT NULL REFERENCES hubs(id) ON DELETE RESTRICT,
  -- The job's id in src/jobs/registry.ts ("meeting_summary", "news_sync", …).
  job_id      TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ok: nothing to report. flagged: finished, but produced something an
  -- admin must check. failed: the run, or part of it, did not work.
  status      TEXT NOT NULL CHECK (status IN ('ok', 'flagged', 'failed')),
  -- One line, admin-facing: what the run produced ("2 created, 1 waiting").
  summary     TEXT NOT NULL DEFAULT '',
  -- Why the run is flagged or failed, one admin-facing line per problem.
  problems    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The runner's own outcome body, for whoever debugs it.
  details     JSONB NULL
);

CREATE INDEX IF NOT EXISTS job_runs_hub_job_started_idx
  ON job_runs (hub_id, job_id, started_at DESC);

COMMENT ON TABLE job_runs IS
  'One row per scheduled-job run that did something, per hub: status, a one-line summary, problems. Read by the admin plugin page (last run) and the admin digest (failures and flags). Operational log; not exported.';

SELECT public._civic_apply_hub_policy('public.job_runs');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, DELETE ON job_runs TO authenticated, service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON job_runs FROM anon;
  END IF;
END $$;
