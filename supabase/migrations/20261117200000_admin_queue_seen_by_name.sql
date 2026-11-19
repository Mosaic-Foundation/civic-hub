-- =====================================================================
-- "Last opened" cursors for the packages' admin queues, by queue name
-- =====================================================================
-- Kernel step 3 (docs/kernel/SURFACE.md): a package names its own review
-- queue (its manifest's publication.queue), so the kernel no longer has a
-- column per package queue. Each admin's cursor for a package queue lives
-- under its name in queues_seen_at ({"briefs": "<time>", ...}). The kernel's
-- own queues (reviews, feedback, edits) keep their columns.
--
-- Backfills the two package queues there are today from their columns, so no
-- admin's counts change. The old columns stay, unread, and go in a later
-- cleanup. Safe to run more than once.
-- =====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS queues_seen_at JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE users
SET queues_seen_at = queues_seen_at
  || CASE WHEN briefs_seen_at IS NOT NULL AND NOT queues_seen_at ? 'briefs'
          THEN jsonb_build_object('briefs', to_jsonb(briefs_seen_at)) ELSE '{}'::jsonb END
  || CASE WHEN meeting_summaries_seen_at IS NOT NULL AND NOT queues_seen_at ? 'meeting_summaries'
          THEN jsonb_build_object('meeting_summaries', to_jsonb(meeting_summaries_seen_at)) ELSE '{}'::jsonb END
WHERE (briefs_seen_at IS NOT NULL AND NOT queues_seen_at ? 'briefs')
   OR (meeting_summaries_seen_at IS NOT NULL AND NOT queues_seen_at ? 'meeting_summaries');
