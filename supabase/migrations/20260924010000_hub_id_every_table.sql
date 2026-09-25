-- hub_id on every tenant table (multi-tenant Phase 2a).
--
-- Contract: BUILD-PLAN-multi-tenant.md → "Phase 2", table list recorded there.
--
-- Additive and safe against a live database. Each table gets
--   hub_id TEXT NOT NULL DEFAULT 'floyd'  REFERENCES hubs(id)
-- and the existing rows are backfilled by the default: every row in the
-- database today was written by Floyd, the only hub that has ever had data.
-- 'floyd' is MIGRATION_DEFAULT_HUB_ID in src/models/hub.ts; SQL cannot import
-- it, so this is the one other spelling, as in the two migrations before it.
--
-- The DEFAULT is a migration device. It keeps a writer that has not yet been
-- converted to forHub() working, and it is removed by the cleanup migration a
-- week after the cutover, at which point a write with no hub fails as it
-- should.
--
-- ON DELETE RESTRICT, unlike hub_settings and sessions (CASCADE): those are
-- configuration and credentials, which are litter once their hub is gone.
-- These are what residents said and did. Deleting a hub that still holds any
-- of it must fail; suspension is how a hub stops serving.
--
-- Not here:
--   hubs          the registry itself; has no hub_id.
--   hub_settings  keyed (hub_id, key) since 20260922020000.
--   sessions      hub_id since 20260922050000.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'active_vote_keys', 'brief_responses', 'community_inputs',
    'deliberation_drafts', 'deliberation_submissions', 'deliberation_votes',
    'events', 'feedback_submissions', 'link_previews', 'pending_verifications',
    'process_links', 'process_reviews', 'project_comments', 'project_drafts',
    'project_sentiments', 'project_updates', 'projects', 'proposal_drafts',
    'proposal_supports', 'proposals', 'review_turns', 'users', 'vote_drafts',
    'vote_participation', 'vote_records', 'waitlist', 'wordcloud_submissions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- A constant default is a catalog change in Postgres 11+: no table
    -- rewrite, and no row trigger fires — which matters for `events` and
    -- `review_turns`, whose triggers refuse any UPDATE.
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS hub_id TEXT NOT NULL DEFAULT %L',
      t, 'floyd');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_hub_id_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE RESTRICT',
      t, t || '_hub_id_fkey');
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated, service_role', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- processes: the column already exists, and meant something else.
--
-- processes.hub_id (20260416000200) held a per-row copy of the PROTOCOL id —
-- 'civic-hub-local' on every row, the value of CIVIC_HUB_ID. That identity
-- now lives on hubs.protocol_hub_id (20260924000000), so this column is
-- repurposed as the tenant key, like every other table's (Adam, 2026-09-24).
-- Every row today is Floyd's.
--
-- The backfill is a real UPDATE, so the two row triggers are held off for it:
-- it must not stamp every process as "updated today", and the search document
-- does not depend on hub_id.
-- ---------------------------------------------------------------------------
ALTER TABLE processes DISABLE TRIGGER processes_updated_at;
ALTER TABLE processes DISABLE TRIGGER processes_search_doc_trigger;
UPDATE processes SET hub_id = 'floyd' WHERE hub_id IS DISTINCT FROM 'floyd';
ALTER TABLE processes ENABLE TRIGGER processes_search_doc_trigger;
ALTER TABLE processes ENABLE TRIGGER processes_updated_at;

ALTER TABLE processes ALTER COLUMN hub_id SET DEFAULT 'floyd';
ALTER TABLE processes ALTER COLUMN hub_id SET NOT NULL;
ALTER TABLE processes DROP CONSTRAINT IF EXISTS processes_hub_id_fkey;
ALTER TABLE processes
  ADD CONSTRAINT processes_hub_id_fkey
  FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE RESTRICT;
-- Guarded (Phase 2c): these are Supabase's role names; on plain Postgres
-- they do not exist, and the grant is skipped rather than failing the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON processes TO authenticated, service_role;
  END IF;
END $$;

COMMENT ON COLUMN processes.hub_id IS
  'The hub (hubs.id) this process belongs to. Was the protocol id until 2026-09-24; that is hubs.protocol_hub_id now.';

-- ---------------------------------------------------------------------------
-- Hub-leading indexes, one per table, on its main lookup path.
--
-- Every hub-scoped query filters on hub_id first, and Phase 3's RLS policy is
-- an equality test on it per candidate row, so each table needs an index that
-- starts with it. Where a table's main path is an equality lookup that the
-- next migration makes unique per hub, that unique constraint is the index
-- and none is created here: link_previews, pending_verifications,
-- project_sentiments, deliberation_submissions, deliberation_votes, users,
-- waitlist.
-- ---------------------------------------------------------------------------

-- Receipts. The voter's own choice (getActiveChoice) and "have I voted"
-- are (user, process) lookups; the tally reads every record for a process.
CREATE INDEX IF NOT EXISTS active_vote_keys_hub_user_process_idx
  ON active_vote_keys (hub_id, user_id, process_id);
CREATE INDEX IF NOT EXISTS vote_participation_hub_user_process_idx
  ON vote_participation (hub_id, user_id, process_id);
CREATE INDEX IF NOT EXISTS vote_records_hub_process_idx
  ON vote_records (hub_id, process_id);

-- The feed and the process list: newest first, within a hub.
CREATE INDEX IF NOT EXISTS events_hub_created_idx
  ON events (hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS processes_hub_created_idx
  ON processes (hub_id, created_at DESC);

CREATE INDEX IF NOT EXISTS brief_responses_hub_brief_idx
  ON brief_responses (hub_id, brief_id, created_at);
CREATE INDEX IF NOT EXISTS community_inputs_hub_process_idx
  ON community_inputs (hub_id, process_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS feedback_submissions_hub_created_idx
  ON feedback_submissions (hub_id, created_at DESC);
CREATE INDEX IF NOT EXISTS process_links_hub_from_idx
  ON process_links (hub_id, from_id);
CREATE INDEX IF NOT EXISTS process_reviews_hub_status_idx
  ON process_reviews (hub_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS review_turns_hub_review_idx
  ON review_turns (hub_id, review_id, turn_number);
CREATE INDEX IF NOT EXISTS projects_hub_status_idx
  ON projects (hub_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS project_comments_hub_project_idx
  ON project_comments (hub_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_updates_hub_project_idx
  ON project_updates (hub_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS proposals_hub_status_idx
  ON proposals (hub_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS proposal_supports_hub_proposal_idx
  ON proposal_supports (hub_id, proposal_id);
CREATE INDEX IF NOT EXISTS wordcloud_submissions_hub_prompt_idx
  ON wordcloud_submissions (hub_id, process_id, prompt_id);

-- Drafts: "my drafts in this state".
CREATE INDEX IF NOT EXISTS deliberation_drafts_hub_user_status_idx
  ON deliberation_drafts (hub_id, user_id, status);
CREATE INDEX IF NOT EXISTS project_drafts_hub_user_status_idx
  ON project_drafts (hub_id, user_id, status);
CREATE INDEX IF NOT EXISTS proposal_drafts_hub_user_status_idx
  ON proposal_drafts (hub_id, user_id, status);
CREATE INDEX IF NOT EXISTS vote_drafts_hub_user_status_idx
  ON vote_drafts (hub_id, user_id, status);
