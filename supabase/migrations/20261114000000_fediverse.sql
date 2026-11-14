-- The fediverse feature, phase 1 (features/fediverse/; plan of 2026-11-12):
-- a hub's own account that people follow from Mastodon and the rest of the
-- fediverse.
--
--   fediverse_keys       the hub's signing keys: an RSA key (the HTTP
--                        Signatures Mastodon checks) and an Ed25519 key
--                        (object integrity proofs). Public halves as JWK;
--                        private halves sealed with the deployment's
--                        CIVIC_FEDIVERSE_SECRET (src/services/sealedSecrets.ts),
--                        never stored in the clear. Made the first time the
--                        hub's account is asked for, one row per hub.
--   fediverse_followers  the accounts following the hub: their address,
--                        their inbox (where the hub delivers to them) and
--                        the Follow they sent. Removed when they unfollow.
--
-- Additive: two new tables. Nothing existing changes. Forced RLS by the hub
-- template, like every hub table.

CREATE TABLE IF NOT EXISTS fediverse_keys (
  hub_id                  text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  rsa_public              jsonb NOT NULL,
  rsa_private_sealed      text NOT NULL CHECK (rsa_private_sealed LIKE 'v1.%'),
  ed25519_public          jsonb NOT NULL,
  ed25519_private_sealed  text NOT NULL CHECK (ed25519_private_sealed LIKE 'v1.%'),
  created_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id)
);
COMMENT ON TABLE fediverse_keys IS
  'A hub''s fediverse signing keys (features/fediverse). Private halves sealed with CIVIC_FEDIVERSE_SECRET and the hub id; not exported (a new host makes new keys).';
SELECT public._civic_apply_hub_policy('public.fediverse_keys');

CREATE TABLE IF NOT EXISTS fediverse_followers (
  hub_id            text NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  actor_uri         text NOT NULL CHECK (actor_uri ~ '^https?://'),
  inbox_url         text NOT NULL CHECK (inbox_url ~ '^https?://'),
  shared_inbox_url  text NULL CHECK (shared_inbox_url IS NULL OR shared_inbox_url ~ '^https?://'),
  handle            text NULL CHECK (handle IS NULL OR length(handle) <= 600),
  follow_id         text NOT NULL,
  followed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, actor_uri)
);
COMMENT ON TABLE fediverse_followers IS
  'Accounts following a hub from the fediverse (features/fediverse): where to deliver to them and the Follow they sent. Deleted on Undo.';
SELECT public._civic_apply_hub_policy('public.fediverse_followers');
