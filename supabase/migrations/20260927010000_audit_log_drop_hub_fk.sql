-- control_audit_log.target_hub_id stops being a foreign key (2026-09-27,
-- Adam). NOT ADDITIVE: drops one constraint, deliberately, and nothing else.
--
-- WHY. scripts/purge-hub.ts permanently deletes a never-used hub so its slug
-- and hostname are free again. The audit log is append-only (a trigger
-- refuses UPDATE and DELETE for every role), and every hub has at least its
-- hub.create row, so while target_hub_id references hubs(id) no hub could
-- ever be deleted — and the purge's own audit row, written before the
-- delete, would block it too.
--
-- WHAT STAYS. Every audit row keeps target_hub_id as plain text, so a purged
-- hub's whole history survives. If its slug is used again, the hub.purge row
-- is the dividing line: its `before` holds the purged hub's full `hubs` row,
-- created_at included, so the console can tell the two lives apart.

ALTER TABLE control_audit_log DROP CONSTRAINT IF EXISTS control_audit_log_target_hub_id_fkey;

COMMENT ON COLUMN control_audit_log.target_hub_id IS
  'The hub acted on, as text. Not a foreign key since 20260927010000: a purged hub''s rows stay. A reused slug''s lives are split by its hub.purge row.';
