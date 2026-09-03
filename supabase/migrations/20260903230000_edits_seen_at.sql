-- =====================================================================
-- Notification "seen" marker for edited projects a user supports
-- =====================================================================
-- Drives the account-menu badge for supporters who are not on the email
-- digest (Adam, 2026-09-03). The badge counts projects the user supports
-- that were edited since they last looked; opening one from the menu
-- stamps edits_seen_at = now(), clearing the badge — same shape as
-- reviews_seen_at (20260625000000).
-- =====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS edits_seen_at TIMESTAMPTZ;
