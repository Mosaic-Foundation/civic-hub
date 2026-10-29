-- Design pass (2026-10-29): two per-person settings. Additive: two columns
-- with defaults, so every existing person reads as before (notices on; the
-- light look, which is what everyone saw).
--
--   users.notices_email  "Notices about things I take part in" (decision 15):
--                        what notify() sends (an event's change or
--                        cancellation, a message to the people going). On by
--                        default, and apart from the digest: unsubscribing
--                        from the digest no longer stops these.
--   users.appearance     "Appearance: light / dark / follow system" (decision
--                        9): the person's own choice, not the hub's. Light by
--                        default.
--
-- No grant: users already grants SELECT, INSERT, UPDATE, DELETE to
-- authenticated and service_role (20260924030000), which covers new columns.
-- Applies twice without error.

ALTER TABLE users ADD COLUMN IF NOT EXISTS notices_email boolean NOT NULL DEFAULT true;

ALTER TABLE users ADD COLUMN IF NOT EXISTS appearance text NOT NULL DEFAULT 'light';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_appearance_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_appearance_check CHECK (appearance IN ('light', 'dark', 'system'));
  END IF;
END $$;
