-- One fresh code confirms the console's catalog actions for ten minutes
-- (plugin session 2, ADR-015): Approve, Withdraw, Sign approved entries and
-- Mark required, on the session that entered the code. Additive: one
-- nullable column; old code never reads it. Each action is still audited.
-- Never raises 40001.

ALTER TABLE control_sessions ADD COLUMN IF NOT EXISTS catalog_confirmed_until timestamptz;

COMMENT ON COLUMN control_sessions.catalog_confirmed_until IS
  'Until when this session''s catalog actions need no fresh code: set for ten minutes when one is entered for a catalog action (src/control/router.ts, catalogStepUp).';
