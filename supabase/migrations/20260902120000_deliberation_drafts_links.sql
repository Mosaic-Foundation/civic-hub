-- Conversation drafts carry proposed process links, like every other draft
-- type. Conversations joined the drafting pattern (20260828200000) three days
-- after process linking shipped (20260825000000), and the links column was
-- never added — so the conversation form had no link picker. Same shape as
-- proposal_drafts / vote_drafts / project_drafts:
--   [{ "to_id": "proc_x", "relation": "continues" }]
-- Materialized into process_links by submitForReview() at submission.
--
-- Apply to prod BEFORE deploying the code that writes it (a PATCH carrying
-- links would otherwise fail on the missing column).

BEGIN;

ALTER TABLE deliberation_drafts
  ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
