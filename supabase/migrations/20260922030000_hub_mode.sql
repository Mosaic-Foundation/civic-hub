-- `hubs.mode` — where a hub is in its life, as one ordered state.
--
-- Decided with Adam, 2026-09-22. This replaces two independent booleans,
-- CIVIC_BETA_MODE and the demo bypass, which could both be true at once and
-- described a state that has no meaning: demo lets anyone in with any code,
-- beta lets only allowlisted people in. The only reason that was not already
-- a bug is that the demo check happened to return before the beta check ran.
-- One value cannot contradict itself.
--
--   demo  open to anyone, no real email verification (any six digits),
--         demo banner. For showing the product.
--   beta  real verification, allowlist gate, waitlist form, beta banner.
--   live  real verification, open to anyone, no banner.
--
-- `mode` and `status` are different axes and both belong on the row:
-- `status` answers "is this hub serving at all", `mode` answers "how open is
-- it to whom".
--
-- NULLABLE ON PURPOSE, with no default. A null means "not configured yet",
-- and the reader then falls back to the environment variables exactly as
-- before. That is what makes this migration safe to apply to a live database:
-- Floyd's existing row stays null, production keeps reading CIVIC_BETA_MODE,
-- and nothing changes until a mode is written deliberately. A DEFAULT 'live'
-- would have silently un-gated a hub that is currently in private beta.

ALTER TABLE hubs
  ADD COLUMN IF NOT EXISTS mode TEXT;

ALTER TABLE hubs
  DROP CONSTRAINT IF EXISTS hubs_mode_check;
ALTER TABLE hubs
  ADD CONSTRAINT hubs_mode_check
  CHECK (mode IS NULL OR mode IN ('demo', 'beta', 'live'));

COMMENT ON COLUMN hubs.mode IS
  'Lifecycle state: demo | beta | live. NULL means fall back to the env vars.';
