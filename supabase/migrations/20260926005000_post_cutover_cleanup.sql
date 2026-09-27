-- The post-cutover cleanup (RUNBOOK-cutover.md §7; RUNBOOK-release-1.md §2).
--
-- THE ONE NON-ADDITIVE MIGRATION, reviewed by Adam. It drops the migration
-- devices the multi-tenant migrations left in place so that the single-tenant
-- `main` build (3283f48) could still run against the database during the
-- watching week. After it, that build no longer works here: rollback to it is
-- gone. Nothing in it touches a row.
--
-- WHY THIS VERSION NUMBER. 20260926005000 sorts before 20260926010000, the
-- first of the four migrations the release-1 sitting pushes after it. The
-- sitting applies this one first, from its own commit (RUNBOOK-release-1.md
-- §2), so the next dry run lists exactly the four. A database that already
-- has the four (dev, a local stack) needs `db push --include-all` or a reset;
-- the statements do not depend on the four, and the four do not depend on
-- anything dropped here.
--
-- Idempotent: every drop is IF EXISTS, and each key promotion drops and
-- re-adds the same key, so a second run changes nothing.
--
-- What it drops, and where each came from:
--   1. DEFAULT 'floyd' on every hub_id column (20260922020000, 20260922050000,
--      20260924010000: "a migration device, not the design"). A writer that
--      forgets its hub now fails NOT NULL instead of landing in Floyd.
--   2. The old global keys kept beside the per-hub ones (20260924020000).
--      The per-hub constraint becomes the key. Until now one email was one
--      account on one hub, across all hubs.
--   3. The old single-column foreign keys kept beside the composite ones
--      (20260924060000), all 14.
--   4. The deprecated search wrappers without p_hub_id (20260924050000).
--   5. The rollback index, in case a rollback left it (RUNBOOK-cutover.md §6).
-- And a final check that raises (undoing all of it) if anything named here
-- is still present.

-- 1. No hub by default ---------------------------------------------------------
ALTER TABLE active_vote_keys         ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE brief_responses          ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE community_inputs         ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE deliberation_drafts      ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE deliberation_submissions ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE deliberation_votes       ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE events                   ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE feedback_submissions     ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE hub_settings             ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE link_previews            ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE pending_verifications    ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE process_links            ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE process_reviews          ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE processes                ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE project_comments         ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE project_drafts           ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE project_sentiments       ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE project_updates          ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE projects                 ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE proposal_drafts          ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE proposal_supports        ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE proposals                ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE review_turns             ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE sessions                 ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE users                    ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE vote_drafts              ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE vote_participation       ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE vote_records             ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE waitlist                 ALTER COLUMN hub_id DROP DEFAULT;
ALTER TABLE wordcloud_submissions    ALTER COLUMN hub_id DROP DEFAULT;

-- 2. Per-hub keys only -----------------------------------------------------------
-- users keeps its primary key (id); only the global email unique goes.
-- users_hub_email_key UNIQUE (hub_id, email) stays as the account key.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

-- The other three had the global column as their PRIMARY KEY. The per-hub
-- unique becomes the primary key, under the old name, so each table still
-- has one (replication and most tools expect a primary key).
-- Every row already satisfies it: the per-hub unique has held since 2a.
ALTER TABLE pending_verifications DROP CONSTRAINT IF EXISTS pending_verifications_pkey;
ALTER TABLE pending_verifications DROP CONSTRAINT IF EXISTS pending_verifications_hub_email_key;
ALTER TABLE pending_verifications ADD CONSTRAINT pending_verifications_pkey PRIMARY KEY (hub_id, email);

ALTER TABLE waitlist DROP CONSTRAINT IF EXISTS waitlist_pkey;
ALTER TABLE waitlist DROP CONSTRAINT IF EXISTS waitlist_hub_email_key;
ALTER TABLE waitlist ADD CONSTRAINT waitlist_pkey PRIMARY KEY (hub_id, email);

ALTER TABLE link_previews DROP CONSTRAINT IF EXISTS link_previews_pkey;
ALTER TABLE link_previews DROP CONSTRAINT IF EXISTS link_previews_hub_url_key;
ALTER TABLE link_previews ADD CONSTRAINT link_previews_pkey PRIMARY KEY (hub_id, url);

-- Not dropped, on purpose: the (process or project, user) primary keys
-- (project_sentiments, deliberation_submissions, deliberation_votes). Their
-- ids already pin one hub, so they never disagree with the per-hub keys.

-- 3. Composite foreign keys only -------------------------------------------------
-- Each has a <table>_hub_<column>_fkey twin with the same ON DELETE rule.
ALTER TABLE sessions              DROP CONSTRAINT IF EXISTS sessions_user_id_fkey;
ALTER TABLE processes             DROP CONSTRAINT IF EXISTS processes_review_id_fkey;
ALTER TABLE proposal_supports     DROP CONSTRAINT IF EXISTS proposal_supports_proposal_id_fkey;
ALTER TABLE feedback_submissions  DROP CONSTRAINT IF EXISTS feedback_submissions_user_id_fkey;
ALTER TABLE project_updates       DROP CONSTRAINT IF EXISTS project_updates_project_id_fkey;
ALTER TABLE project_sentiments    DROP CONSTRAINT IF EXISTS project_sentiments_project_id_fkey;
ALTER TABLE project_comments      DROP CONSTRAINT IF EXISTS project_comments_project_id_fkey;
ALTER TABLE wordcloud_submissions DROP CONSTRAINT IF EXISTS wordcloud_submissions_process_id_fkey;
ALTER TABLE process_reviews       DROP CONSTRAINT IF EXISTS process_reviews_process_id_fkey;
ALTER TABLE review_turns          DROP CONSTRAINT IF EXISTS review_turns_review_id_fkey;
ALTER TABLE process_links         DROP CONSTRAINT IF EXISTS process_links_from_id_fkey;
ALTER TABLE process_links         DROP CONSTRAINT IF EXISTS process_links_to_id_fkey;
ALTER TABLE brief_responses       DROP CONSTRAINT IF EXISTS brief_responses_brief_id_fkey;
ALTER TABLE brief_responses       DROP CONSTRAINT IF EXISTS brief_responses_responder_id_fkey;

-- 4. Search takes a hub ----------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_processes(text, text[], timestamptz, timestamptz, text, integer, integer);
DROP FUNCTION IF EXISTS public.search_processes_count(text, text[], timestamptz, timestamptz);

-- 5. The rollback index ----------------------------------------------------------
DROP INDEX IF EXISTS public.hub_settings_key_rollback;

-- Check -------------------------------------------------------------------------
-- Raises, and so undoes the whole migration, if any device survived: a
-- 'floyd' default on a table added since (or missed above), a global key, a
-- single-column reference beside a composite one, or a hub-less search.
DO $$
DECLARE
  leftovers text;
BEGIN
  SELECT string_agg(item, ', ') INTO leftovers FROM (
    SELECT format('%I.%I default', c.table_name, c.column_name) AS item
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_default ILIKE '%floyd%'
    UNION ALL
    SELECT format('%s %s', conrelid::regclass, conname)
      FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace
       AND conname IN ('users_email_key', 'pending_verifications_hub_email_key',
                       'waitlist_hub_email_key', 'link_previews_hub_url_key')
    UNION ALL
    SELECT format('%s %s', conrelid::regclass, conname)
      FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace AND contype = 'p'
       AND conname IN ('pending_verifications_pkey', 'waitlist_pkey', 'link_previews_pkey')
       AND NOT EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = conrelid AND a.attnum = conkey[1] AND a.attname = 'hub_id')
    UNION ALL
    SELECT format('%s %s', f.conrelid::regclass, f.conname)
      FROM pg_constraint f
     WHERE f.connamespace = 'public'::regnamespace AND f.contype = 'f'
       AND array_length(f.conkey, 1) = 1
       AND f.confrelid <> 'public.hubs'::regclass
       AND EXISTS (
         SELECT 1 FROM pg_constraint g
          WHERE g.conrelid = f.conrelid AND g.contype = 'f'
            AND g.confrelid = f.confrelid AND array_length(g.conkey, 1) = 2
            AND f.conkey[1] = ANY (g.conkey))
    UNION ALL
    SELECT p.oid::regprocedure::text
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('search_processes', 'search_processes_count')
       AND NOT ('p_hub_id' = ANY (coalesce(p.proargnames, '{}')))
    UNION ALL
    SELECT 'index hub_settings_key_rollback'
     WHERE to_regclass('public.hub_settings_key_rollback') IS NOT NULL
  ) s;
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'post-cutover cleanup incomplete: %', leftovers;
  END IF;
END $$;
