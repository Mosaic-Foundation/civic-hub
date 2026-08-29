-- Conversation drafting + unified process durations (Adam, 2026-08-28).
--
-- 1. deliberation_drafts — conversations join the drafting pattern
--    (assistant help on topic + framing, CoC review, submit-for-review).
--    Mirrors vote_drafts; title = the topic, description = the framing.
--    seed_statements is one-per-line text, outside the assistant's reach.
--
-- 2. Every duration-bearing process type now offers the same picker
--    (2 weeks / 1 month / 6 weeks / 2 months / 3 months) and defaults to
--    6 weeks — so the drafts columns' defaults move to 3628800000 ms.
--    Conversations store a duration and compute their deadline when the
--    conversation is STARTED (participation window = active window), not
--    at submission.
--
-- Apply by hand in the Supabase SQL editor, DEV FIRST (the CLI link
-- points at prod — do not `db push`). Prod gets this only at ship time,
-- before the code push.

CREATE TABLE deliberation_drafts (
  id                          TEXT PRIMARY KEY,
  user_id                     TEXT NOT NULL,
  title                       TEXT NOT NULL DEFAULT '',   -- conversation topic
  description                 TEXT NOT NULL DEFAULT '',   -- framing
  seed_statements             TEXT NOT NULL DEFAULT '',   -- one per line
  duration_ms                 BIGINT NOT NULL DEFAULT 3628800000,  -- 6 weeks
  participation_threshold     INTEGER,
  conversation_history        JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_review_result          JSONB,
  draft_modified_since_review BOOLEAN NOT NULL DEFAULT false,
  assistant_helped            BOOLEAN NOT NULL DEFAULT false,
  status                      TEXT NOT NULL DEFAULT 'drafting',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deliberation_drafts_user_status
  ON deliberation_drafts (user_id, status);

CREATE TRIGGER set_deliberation_drafts_updated_at
  BEFORE UPDATE ON deliberation_drafts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE deliberation_drafts ENABLE ROW LEVEL SECURITY;

-- Unified 6-week default across the drafting types. Existing rows keep
-- their values; only newly created drafts pick up the new default.
ALTER TABLE proposal_drafts ALTER COLUMN proposal_duration_ms SET DEFAULT 3628800000;
ALTER TABLE vote_drafts     ALTER COLUMN voting_duration_ms   SET DEFAULT 3628800000;
