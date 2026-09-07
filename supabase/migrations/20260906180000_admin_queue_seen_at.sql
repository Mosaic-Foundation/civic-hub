-- =====================================================================
-- "Last opened" cursors for the admin tabs
-- =====================================================================
-- The admin tabs carry counts of what is NEW in each queue since the admin
-- last opened that tab (Adam, 2026-09-06: "new is defined by items that I
-- haven't viewed"). Reviews and Edits already had cursors
-- (reviews_seen_at 20260625000000, edits_seen_at 20260903230000); these are
-- the other three. Opening the tab stamps its column.
-- =====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS feedback_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS briefs_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS meeting_summaries_seen_at TIMESTAMPTZ;
