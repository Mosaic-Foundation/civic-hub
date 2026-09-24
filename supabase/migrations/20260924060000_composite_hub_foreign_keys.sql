-- Composite foreign keys: a row can only reference a row on its own hub
-- (Phase 2b, step 1).
--
-- Contract: BUILD-PLAN-multi-tenant.md → "Phase 2b adds" item 1, which lists
-- the 14 row-to-row references below.
--
-- Until now `sessions.user_id REFERENCES users(id)` accepted a session on
-- Athens pointing at a Floyd user, because ids are global and the key never
-- looked at hub_id. forHub() stops the application writing one; this stops
-- the database accepting one, whoever writes it.
--
-- Two halves:
--   1. `UNIQUE (hub_id, id)` on each referenced table (users, proposals,
--      projects, processes, process_reviews). `id` is already the primary
--      key, so this never disagrees with it; it exists to be a composite
--      foreign-key target.
--   2. For each reference, `(hub_id, <ref>_id) REFERENCES parent (hub_id, id)`
--      with the old key's ON DELETE rule. SET NULL names only the reference
--      column: nulling hub_id too would violate its NOT NULL.
--
-- The old single-column keys STAY until the cleanup migration after cutover
-- drops them (with the DEFAULT 'floyd's), so this is additive in effect:
-- every write that passed before still passes, unless it crossed hubs.
--
-- Each new key is added NOT VALID and then validated. ADD takes a brief lock
-- and checks only new writes; VALIDATE scans existing rows under a lock that
-- does not block reads or writes. A cross-hub row already in the table fails
-- the VALIDATE, and the whole migration with it: that is the point.
--
-- A nullable reference (feedback_submissions.user_id, processes.review_id) is
-- MATCH SIMPLE, the default: a null reference is not checked, as before.

-- 1. Composite targets on the referenced tables.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_hub_id_id_key;
ALTER TABLE users ADD CONSTRAINT users_hub_id_id_key UNIQUE (hub_id, id);

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_hub_id_id_key;
ALTER TABLE proposals ADD CONSTRAINT proposals_hub_id_id_key UNIQUE (hub_id, id);

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_hub_id_id_key;
ALTER TABLE projects ADD CONSTRAINT projects_hub_id_id_key UNIQUE (hub_id, id);

ALTER TABLE processes DROP CONSTRAINT IF EXISTS processes_hub_id_id_key;
ALTER TABLE processes ADD CONSTRAINT processes_hub_id_id_key UNIQUE (hub_id, id);

ALTER TABLE process_reviews DROP CONSTRAINT IF EXISTS process_reviews_hub_id_id_key;
ALTER TABLE process_reviews ADD CONSTRAINT process_reviews_hub_id_id_key UNIQUE (hub_id, id);

-- Sessions already on the wrong hub. Since Phase 2a a session resolves only
-- to a user on its own hub, so a session whose hub differs from its user's
-- authenticates as nobody (401): a dead credential. The rehearsal against a
-- copy of dev found one (an account kept on one hub, signed in on another
-- before 2a). Deleting it is the only data this migration touches; any other
-- cross-hub row is content, not a credential, and fails the VALIDATE below.
DELETE FROM sessions s
USING users u
WHERE u.id = s.user_id
  AND u.hub_id <> s.hub_id;

-- 2. The 14 references. Name: <table>_hub_<column>_fkey, beside the old
--    <table>_<column>_fkey.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- child table,           column,         parent,            on delete
      ('sessions',              'user_id',      'users',           'CASCADE'),
      ('feedback_submissions',  'user_id',      'users',           'SET NULL (user_id)'),
      ('brief_responses',       'responder_id', 'users',           'NO ACTION'),
      ('proposal_supports',     'proposal_id',  'proposals',       'CASCADE'),
      ('project_updates',       'project_id',   'projects',        'CASCADE'),
      ('project_sentiments',    'project_id',   'projects',        'CASCADE'),
      ('project_comments',      'project_id',   'projects',        'CASCADE'),
      ('process_links',         'from_id',      'processes',       'CASCADE'),
      ('process_links',         'to_id',        'processes',       'CASCADE'),
      ('process_reviews',       'process_id',   'processes',       'CASCADE'),
      ('wordcloud_submissions', 'process_id',   'processes',       'NO ACTION'),
      ('brief_responses',       'brief_id',     'processes',       'CASCADE'),
      ('review_turns',          'review_id',    'process_reviews', 'CASCADE'),
      ('processes',             'review_id',    'process_reviews', 'NO ACTION')
    ) AS t(child, col, parent, on_delete)
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      r.child, r.child || '_hub_' || r.col || '_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (hub_id, %I) '
        'REFERENCES %I (hub_id, id) ON DELETE %s NOT VALID',
      r.child, r.child || '_hub_' || r.col || '_fkey', r.col, r.parent, r.on_delete);
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I',
      r.child, r.child || '_hub_' || r.col || '_fkey');
  END LOOP;
END
$$;
