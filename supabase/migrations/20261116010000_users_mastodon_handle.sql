-- A person's Mastodon (fediverse) handle (Adam, 2026-11-15): Share on
-- Mastodon asks for it once, saves it here, and opens that server from then
-- on; Settings shows it to change. Their own setting, not shown to anyone.
--
-- Additive: one nullable column. No grant: users already grants SELECT,
-- INSERT, UPDATE, DELETE to authenticated and service_role (20260924030000),
-- which covers new columns. Applies twice without error.

ALTER TABLE users ADD COLUMN IF NOT EXISTS mastodon_handle text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_mastodon_handle_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_mastodon_handle_check
      CHECK (mastodon_handle IS NULL OR (length(mastodon_handle) <= 320 AND mastodon_handle ~ '^(@?[A-Za-z0-9_.-]+@)?[a-z0-9.-]+\.[a-z]{2,63}$'));
  END IF;
END $$;

COMMENT ON COLUMN users.mastodon_handle IS
  'The person''s fediverse handle (@name@server) or just their server, for Share on Mastodon. Their own; never shown.';
