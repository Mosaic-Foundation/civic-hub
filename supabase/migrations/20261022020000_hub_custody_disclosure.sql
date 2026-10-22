-- Who stands behind a hub's identity, declared (Architecture 3, ADR-010;
-- Adam, 2026-10-21, Q7; identity spec §5.3 and §12.4).
--
-- The space DID's custody arrangement MUST be disclosed in the space manifest
-- (§5.3): who can speak as the community. And the hub runs stub identity at a
-- declared assurance level (§12.4). Both are per-hub operator facts, set in
-- the console and served in /.well-known/civic.json; nothing in code names a
-- place. Null means "not declared yet" and the manifest omits them.
--
-- Additive: three nullable columns. The arrangement vocabulary is §5.3's.
-- Never raises; no 40001; no new functions.

ALTER TABLE hubs
  ADD COLUMN IF NOT EXISTS custody_arrangement TEXT
    CHECK (custody_arrangement IS NULL OR custody_arrangement IN ('designated_custodian', 'multisig', 'threshold')),
  ADD COLUMN IF NOT EXISTS custodian TEXT,
  ADD COLUMN IF NOT EXISTS assurance_level TEXT;

NOTIFY pgrst, 'reload schema';
