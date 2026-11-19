-- =====================================================================
-- Feedback's "last opened" cursor, by queue name
-- =====================================================================
-- Kernel step 4: Feedback is a feature plugin (features/feedback), and a
-- feature names its own admin queue (FeatureServer.queues), so its cursor
-- lives under its name in users.queues_seen_at, as the packages' have since
-- 20261117200000. The kernel's own queues are now Reviews and Edits.
--
-- Copies each admin's feedback_seen_at there, so no admin's Feedback count
-- changes. The old column stays, unread, and goes in a later cleanup. Safe to
-- run more than once.
-- =====================================================================

UPDATE users
SET queues_seen_at = queues_seen_at || jsonb_build_object('feedback', to_jsonb(feedback_seen_at))
WHERE feedback_seen_at IS NOT NULL AND NOT queues_seen_at ? 'feedback';
