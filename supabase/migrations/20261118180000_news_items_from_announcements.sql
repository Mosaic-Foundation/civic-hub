-- News Sync is its own plugin (Adam, 2026-11-18): the posts it copies in are
-- News items (civic.news, packages/civic.news_sync), not announcements, so it
-- works with Announcements switched off and Announcements works with it off.
--
-- NOT ADDITIVE: it rewrites existing rows. Two parts, one transaction.
--
-- 1. THE POSTS ALREADY COPIED IN BECOME NEWS ITEMS.
--    Every announcement News Sync made carries `state.source` (an object: the
--    original's permalink and where it came from); no announcement anyone
--    posted by hand has one. Those rows get type civic.news and
--    state.type 'civic.news'. Nothing else about them changes: the same id,
--    title, text, dates, status, pin marks and history. Their state keeps the
--    announcement's shape (`content`, `author_role`), which the News package
--    reads. Their events are not touched (the event log is not rewritten):
--    the feed reads a stored announcement event with a `source` as a News
--    card, and follows the process's type as it is now for its plugin switch.
--    The updated_at trigger is held off for the one statement, so no post
--    looks "updated today" (the pattern of 20261011000000).
--
-- 2. "SHOW AS" BECOMES THE PILL LABEL.
--    plugin.news_sync.show_as ("news" | "announcement") is gone: a News item
--    is never an announcement. A hub that had chosen "announcement" keeps that
--    word on its posts' pill: its new plugin.news_sync.pill_label is set to
--    "Announcement" (unless it has one already). Then every show_as row is
--    deleted.
--
-- Until the News Sync 0.1.0 catalog entry (20261118171150) is approved in the
-- console, the News Sync plugin is not mounted, so these posts are not shown
-- on that deployment: approve it right after this release's migrations.
--
-- To undo part 1 (the rows News Sync made since this release have no
-- author_role and stay News):
--   UPDATE processes SET type = 'civic.announcement',
--          state = jsonb_set(state, '{type}', '"civic.announcement"')
--    WHERE type = 'civic.news' AND state ? 'author_role';
--
-- Applies twice without error: a second run finds nothing to change.

BEGIN;

-- 1. News items ----------------------------------------------------------------
ALTER TABLE processes DISABLE TRIGGER processes_updated_at;
UPDATE processes
   SET type = 'civic.news',
       state = jsonb_set(state, '{type}', '"civic.news"')
 WHERE type = 'civic.announcement'
   AND jsonb_typeof(state -> 'source') = 'object'
   AND coalesce(state -> 'source' ->> 'share_url', '') <> '';
ALTER TABLE processes ENABLE TRIGGER processes_updated_at;

-- 2. The pill label -------------------------------------------------------------
INSERT INTO hub_settings (hub_id, key, value)
SELECT hub_id, 'plugin.news_sync.pill_label', 'Announcement'
  FROM hub_settings
 WHERE key = 'plugin.news_sync.show_as'
   AND value = 'announcement'
ON CONFLICT (hub_id, key) DO NOTHING;

DELETE FROM hub_settings WHERE key = 'plugin.news_sync.show_as';

COMMIT;
