-- Per-hub uniqueness, added BESIDE the global constraints (Phase 2a).
--
-- Contract: BUILD-PLAN-multi-tenant.md → "Phase 2" → per-hub uniqueness,
-- where each pair below is listed with which constraint is old and which new.
--
-- On one database per hub, "unique email" meant "unique on this hub". On a
-- shared database it means "unique on every hub", which stops one person
-- holding an account on two hubs. The fix is `unique (hub_id, email)`.
--
-- This is the one change in Phase 2 that is not additive in its end state,
-- so it is done in two halves. THIS migration adds the per-hub constraint and
-- leaves the global one in place, so today every row satisfies both and no
-- writer can break. The cleanup migration (a week after cutover, with the
-- column defaults) drops the global one. Until then the global constraint
-- still wins: one email is one account on one hub.
--
-- The new constraints are also what forHub() needs: its upsert requires the
-- conflict target to include hub_id, because an upsert that conflicts on a
-- global key updates whichever hub's row it hits.
--
-- Not made per-hub, on purpose: generated identifiers (every `id`,
-- sessions.token, vote_records.receipt_id). They are random, so global
-- uniqueness never blocks a second hub, and it is strictly stronger.

-- Accounts. Old: users_email_key UNIQUE (email).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_hub_email_key;
ALTER TABLE users ADD CONSTRAINT users_hub_email_key UNIQUE (hub_id, email);

-- Sign-in codes. Old: pending_verifications_pkey PRIMARY KEY (email).
ALTER TABLE pending_verifications DROP CONSTRAINT IF EXISTS pending_verifications_hub_email_key;
ALTER TABLE pending_verifications
  ADD CONSTRAINT pending_verifications_hub_email_key UNIQUE (hub_id, email);

-- Waitlist. Old: waitlist_pkey PRIMARY KEY (email).
ALTER TABLE waitlist DROP CONSTRAINT IF EXISTS waitlist_hub_email_key;
ALTER TABLE waitlist ADD CONSTRAINT waitlist_hub_email_key UNIQUE (hub_id, email);

-- Link-preview cache. Old: link_previews_pkey PRIMARY KEY (url).
ALTER TABLE link_previews DROP CONSTRAINT IF EXISTS link_previews_hub_url_key;
ALTER TABLE link_previews ADD CONSTRAINT link_previews_hub_url_key UNIQUE (hub_id, url);

-- Upsert targets keyed on a (process or project, user) pair. The ids already
-- pin one hub, so these never disagree with the old keys; they exist so an
-- upsert through forHub() can name hub_id in its conflict target.
-- Old: project_sentiments_pkey PRIMARY KEY (project_id, user_id).
ALTER TABLE project_sentiments DROP CONSTRAINT IF EXISTS project_sentiments_hub_project_user_key;
ALTER TABLE project_sentiments
  ADD CONSTRAINT project_sentiments_hub_project_user_key UNIQUE (hub_id, project_id, user_id);

-- Old: deliberation_submissions_pkey PRIMARY KEY (process_id, user_id).
ALTER TABLE deliberation_submissions DROP CONSTRAINT IF EXISTS deliberation_submissions_hub_process_user_key;
ALTER TABLE deliberation_submissions
  ADD CONSTRAINT deliberation_submissions_hub_process_user_key UNIQUE (hub_id, process_id, user_id);

-- Old: deliberation_votes_pkey PRIMARY KEY (process_id, user_id, statement_id).
ALTER TABLE deliberation_votes DROP CONSTRAINT IF EXISTS deliberation_votes_hub_process_user_statement_key;
ALTER TABLE deliberation_votes
  ADD CONSTRAINT deliberation_votes_hub_process_user_statement_key
  UNIQUE (hub_id, process_id, user_id, statement_id);

-- hub_settings needs nothing: its primary key became (hub_id, key) in
-- 20260922020000, and the global key it replaced is already gone.
