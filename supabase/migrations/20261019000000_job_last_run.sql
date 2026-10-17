-- The last scheduled run of each job, whatever it did (the dashboard slice).
--
-- job_runs records a hub's run only when it did something (a vote_close that
-- closed nothing writes no row), so it cannot say whether a job ran at all.
-- The console's Dashboard needs that to mark a job late. One row per job,
-- replaced at the end of every scheduled run (every hub, or the platform
-- job's one run), including runs that did nothing. A run for one hub by hand
-- (?hub=) is not the schedule and is not recorded here, as it pings no
-- heartbeat either.
--
-- Platform data: a run covers every hub, so the row is no hub's. Deny-all
-- RLS, no policy; written by src/db/jobLastRun.ts, read by the console.
--
-- Additive. No database functions, so no function grants; the table's grants
-- are explicit below.

CREATE TABLE IF NOT EXISTS job_last_run (
  job_id       text        PRIMARY KEY,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz NOT NULL,
  status       text        NOT NULL,
  duration_ms  integer     NOT NULL,
  hubs_run     integer     NOT NULL DEFAULT 0,
  hubs_failed  integer     NOT NULL DEFAULT 0,
  error        text,

  CONSTRAINT job_last_run_status_chk CHECK (status IN ('ok', 'failed')),
  CONSTRAINT job_last_run_duration_chk CHECK (duration_ms >= 0)
);

COMMENT ON TABLE job_last_run IS
  'The last scheduled run of each job (every hub, or the platform job''s run), including runs that did nothing. Platform data: service role only (src/db/jobLastRun.ts, src/control/dashboard/).';
COMMENT ON COLUMN job_last_run.status IS
  'ok, or failed when any hub failed or the run threw (the heartbeat''s /fail).';
COMMENT ON COLUMN job_last_run.hubs_run IS
  'Hubs the run looked at (0 for a platform job).';
COMMENT ON COLUMN job_last_run.error IS
  'One line when the whole run threw; per-hub failures are in job_runs.';

ALTER TABLE job_last_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_last_run FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON job_last_run FROM authenticated;
    -- DELETE for tests that start from an empty table.
    GRANT SELECT, INSERT, UPDATE, DELETE ON job_last_run TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON job_last_run FROM anon;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
