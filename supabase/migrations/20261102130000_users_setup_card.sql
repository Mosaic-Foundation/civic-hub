-- Pilot readiness 2 (2026-11-02): the "Set up your hub" card on the home page,
-- per admin. Two columns on the account, null for everyone, so every admin sees
-- the card until they dismiss it. No backfill (Adam, 2026-11-02).
--
--   users.setup_card_dismissed_at        this admin pressed Dismiss.
--   users.setup_second_admin_skipped_at  this admin pressed Skip on "a second
--                                        admin". A later admin means the step
--                                        is done anyway, so it needs no hub row.
--
-- No grant: users already grants SELECT, INSERT, UPDATE, DELETE to
-- authenticated and service_role (20260924030000), which covers new columns.
-- Additive. Applies twice without error.

ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_card_dismissed_at timestamptz NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_second_admin_skipped_at timestamptz NULL;
