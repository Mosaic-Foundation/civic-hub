-- =====================================================================
-- feedback_submissions — add the 'topic' category
-- =====================================================================
-- Residents can now suggest a subject the Hub should take up ("Suggest a
-- topic") from the same feedback form, rather than starting a process
-- themselves. The category CHECK from 20260429000000 predates that value
-- and would refuse the write, so it is replaced here with the superset.
--
-- Deploy order: apply this BEFORE shipping the code that writes
-- category = 'topic'. Per the 08-22 incident, a shared `main` means the
-- migration must not trail its writer.
--
-- Safe on a running system: the new constraint is a strict superset of
-- the old one, so every existing row already satisfies it and the
-- revalidation scan cannot fail. Re-runnable — the DROP is guarded.
-- =====================================================================

ALTER TABLE feedback_submissions
  DROP CONSTRAINT IF EXISTS feedback_submissions_category_chk;

ALTER TABLE feedback_submissions
  ADD CONSTRAINT feedback_submissions_category_chk
    CHECK (category IN ('idea', 'topic', 'bug', 'moderation', 'general'));

-- feedback_submissions_category_idx (20260429000000) already indexes this
-- column, so reading the topic suggestions as their own group is a plain
-- indexed lookup:
--   SELECT created_at, name, email, message
--     FROM feedback_submissions
--    WHERE category = 'topic'
--    ORDER BY created_at DESC;

COMMENT ON COLUMN feedback_submissions.category IS
  'One of: idea | topic | bug | moderation | general. Used for triage routing. "topic" = a subject a resident thinks the Hub should take up.';
