-- =====================================================================
-- Feedback: optional screenshot on a bug report
-- =====================================================================
-- A bug report can carry one screenshot (Adam, 2026-09-07). The image
-- goes through the same upload path as project/announcement images
-- (Supabase Storage, client-side resize); only the public URL is stored
-- here. Signed-in submitters only — the upload route requires a resident.
-- =====================================================================

ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS screenshot_url TEXT;

COMMENT ON COLUMN feedback_submissions.screenshot_url IS
  'Optional screenshot attached to a bug report; public URL in the post-image bucket. Signed-in submitters only.';
