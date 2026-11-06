-- Pilot readiness 3 (2026-11-06): "Send me a fresh link" on the start page.
--
--   entitlement_links.refreshed  true for a link the invitee asked for from a
--                                used or expired one; false for the console's
--                                own sends. The rate limit (one a minute, three
--                                a day per invite) counts only these, so the
--                                console's send never uses one up.
--
-- No grant: entitlement_links already grants to service_role only
-- (20261102120000), which covers a new column. Additive. Applies twice
-- without error.

ALTER TABLE entitlement_links ADD COLUMN IF NOT EXISTS refreshed boolean NOT NULL DEFAULT false;
