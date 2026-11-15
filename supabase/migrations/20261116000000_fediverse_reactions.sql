-- The fediverse feature, phase 3 (plan of 2026-11-12, items 3 and 4): what
-- comes back to the hub's posts from the fediverse.
--
--   fediverse_replies    a reply to one of the hub's posts, kept as text: the
--                        words, and links to any pictures or video (never the
--                        files). Changed when its author edits it, deleted when
--                        its author deletes it or their account. Stored, not
--                        shown: showing them waits for the identity work.
--   fediverse_reactions  a like or a boost of one of the hub's posts, by whom,
--                        so an undo can take it back and an account counts
--                        once. Counted for admins in Admin → Activity, apart
--                        from residents' participation; never shown publicly.
--
-- Additive: two new tables, forced RLS by the hub template, with their grants.

CREATE TABLE IF NOT EXISTS fediverse_replies (
  hub_id        text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  id            text NOT NULL CHECK (id ~ '^https?://' AND length(id) <= 2000),
  post_id       text NOT NULL,
  actor_uri     text NOT NULL CHECK (actor_uri ~ '^https?://'),
  actor_handle  text NULL CHECK (actor_handle IS NULL OR length(actor_handle) <= 600),
  text          text NOT NULL CHECK (length(text) <= 5000),
  media_links   jsonb NOT NULL DEFAULT '[]'::jsonb,
  url           text NULL CHECK (url IS NULL OR url ~ '^https?://'),
  published_at  timestamptz NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  edited_at     timestamptz NULL,
  PRIMARY KEY (hub_id, id),
  FOREIGN KEY (hub_id, post_id) REFERENCES fediverse_posts (hub_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fediverse_replies_post_idx ON fediverse_replies (hub_id, post_id, received_at);
CREATE INDEX IF NOT EXISTS fediverse_replies_actor_idx ON fediverse_replies (hub_id, actor_uri);
COMMENT ON TABLE fediverse_replies IS
  'Replies from the fediverse to a hub''s posts (features/fediverse), as text with links to media; deleted when their author deletes them. Stored, not shown. Exported.';
SELECT public._civic_apply_hub_policy('public.fediverse_replies');

CREATE TABLE IF NOT EXISTS fediverse_reactions (
  hub_id       text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  activity_id  text NOT NULL CHECK (activity_id ~ '^https?://' AND length(activity_id) <= 2000),
  kind         text NOT NULL CHECK (kind IN ('like', 'boost')),
  post_id      text NOT NULL,
  actor_uri    text NOT NULL CHECK (actor_uri ~ '^https?://'),
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, activity_id),
  FOREIGN KEY (hub_id, post_id) REFERENCES fediverse_posts (hub_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS fediverse_reactions_once_idx ON fediverse_reactions (hub_id, post_id, actor_uri, kind);
CREATE INDEX IF NOT EXISTS fediverse_reactions_received_idx ON fediverse_reactions (hub_id, received_at);
COMMENT ON TABLE fediverse_reactions IS
  'Likes and boosts of a hub''s fediverse posts (features/fediverse), one per account, post and kind; removed on Undo. Counted for admins only. Exported.';
SELECT public._civic_apply_hub_policy('public.fediverse_reactions');

DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('authenticated', 'service_role') LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.fediverse_replies, public.fediverse_reactions TO %I', r);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.fediverse_replies, public.fediverse_reactions FROM anon;
  END IF;
END $$;
