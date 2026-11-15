-- The fediverse feature: each item post records the identities its item has
-- on the hub's civic activity stream (GET /events), so a reader that follows
-- the hub both ways (Mosaic River, say: directly and through Mastodon) can
-- tell a post and an activity are the same thing (Adam, 2026-11-15).
--
--   process_iri   the process IRI every civic activity about it names as its
--                 `context`; the post's Note names it as its `context` too.
--   activity_iri  the id of the civic activity the post announces.
--
-- Additive: two nullable columns (a roundup lists several items, so it has
-- neither; its items carry theirs in `items`).

ALTER TABLE fediverse_posts ADD COLUMN IF NOT EXISTS process_iri text NULL CHECK (process_iri IS NULL OR process_iri ~ '^https?://');
ALTER TABLE fediverse_posts ADD COLUMN IF NOT EXISTS activity_iri text NULL CHECK (activity_iri IS NULL OR activity_iri ~ '^https?://');
COMMENT ON COLUMN fediverse_posts.process_iri IS 'The process IRI the civic activity stream names as context; the Note''s context.';
COMMENT ON COLUMN fediverse_posts.activity_iri IS 'The civic activity this post announces (GET /activities/:id).';
