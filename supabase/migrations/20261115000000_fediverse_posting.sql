-- The fediverse feature, phase 2 (features/fediverse/; plan of 2026-11-12;
-- security audit of 2026-11-14, M2): the hub posts what opens and what is
-- decided, and delivers each post to its followers' servers from a
-- scheduled job, with retries.
--
--   fediverse_kv          Fedify's working memory (messages already seen,
--                         other servers' documents and keys), shared by every
--                         server instance instead of one instance's memory.
--   fediverse_posts       what the hub posted: one item, or a roundup of
--                         several; the text as sent. Never edited.
--   fediverse_deliveries  one row per post and receiving inbox: when it was
--                         delivered, or how many tries and when the next one.
--
-- Additive: three new tables. Nothing existing changes. Forced RLS by the hub
-- template; the grants are in this migration (20261114000100 is why).

CREATE TABLE IF NOT EXISTS fediverse_kv (
  hub_id      text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key ~ '^[0-9a-f.]+$' AND length(key) <= 2000),
  value       jsonb NOT NULL,
  expires_at  timestamptz NULL,
  PRIMARY KEY (hub_id, key)
);
CREATE INDEX IF NOT EXISTS fediverse_kv_expires_idx ON fediverse_kv (hub_id, expires_at) WHERE expires_at IS NOT NULL;
COMMENT ON TABLE fediverse_kv IS
  'Fedify''s key-value store for one hub (features/fediverse/kv.ts): idempotence marks and cached remote documents. Keys are hex-encoded parts joined by dots. Disposable; not exported.';
SELECT public._civic_apply_hub_policy('public.fediverse_kv');

CREATE TABLE IF NOT EXISTS fediverse_posts (
  hub_id        text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  id            text NOT NULL CHECK (id ~ '^[a-z0-9_-]{6,64}$'),
  kind          text NOT NULL CHECK (kind IN ('item', 'roundup')),
  activity_kind text NULL,
  event_id      text NULL,
  process_id    text NULL,
  url           text NOT NULL CHECK (url ~ '^https?://'),
  content       text NOT NULL CHECK (length(content) <= 20000),
  items         jsonb NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fediverse_posts_event_idx ON fediverse_posts (hub_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fediverse_posts_published_idx ON fediverse_posts (hub_id, published_at DESC);
COMMENT ON TABLE fediverse_posts IS
  'What a hub posted to the fediverse (features/fediverse): one item per event, or a roundup listing several (items). Exported.';
SELECT public._civic_apply_hub_policy('public.fediverse_posts');

CREATE TABLE IF NOT EXISTS fediverse_deliveries (
  hub_id           text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  post_id          text NOT NULL,
  inbox_url        text NOT NULL CHECK (inbox_url ~ '^https?://'),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz NULL,
  gave_up_at       timestamptz NULL,
  last_status      integer NULL,
  last_error       text NULL CHECK (last_error IS NULL OR length(last_error) <= 500),
  PRIMARY KEY (hub_id, post_id, inbox_url),
  FOREIGN KEY (hub_id, post_id) REFERENCES fediverse_posts (hub_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fediverse_deliveries_due_idx ON fediverse_deliveries (hub_id, next_attempt_at)
  WHERE delivered_at IS NULL AND gave_up_at IS NULL;
COMMENT ON TABLE fediverse_deliveries IS
  'One post to one inbox (features/fediverse): delivered, given up, or waiting for its next try. Not exported (the next host does not resend).';
SELECT public._civic_apply_hub_policy('public.fediverse_deliveries');

DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('authenticated', 'service_role') LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.fediverse_kv, public.fediverse_posts, public.fediverse_deliveries TO %I', r);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.fediverse_kv, public.fediverse_posts, public.fediverse_deliveries FROM anon;
  END IF;
END $$;
