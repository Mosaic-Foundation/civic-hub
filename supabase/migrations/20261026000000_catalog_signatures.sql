-- Signed approvals (plugin session 2, ADR-015). Additive: three nullable
-- columns on plugin_catalog and two checks every existing row meets. No row
-- changes, no function; old code keeps working on a migrated database (it
-- selects its own columns).
--
--   signature      base64 Ed25519 signature over (package, version, hash,
--                  grant) as canonical JSON (src/plugins/signature.ts), made
--                  by the console when the operator approves the row, or by
--                  "Sign approved entries" for a row approved before.
--   signature_key  the id of the key that signed it ("ed25519:" and 16 hex),
--                  so a rotated key's signatures can still be checked.
--   signed_at      when.
--
-- The shipped rows are signed by the console's "Sign approved entries" after
-- the release (RUNBOOK-release.md), not by this migration: a migration cannot
-- hold the key, and a signature a migration wrote is what this guards against.
--
-- Never raises 40001.

ALTER TABLE plugin_catalog
  ADD COLUMN IF NOT EXISTS signature     text,
  ADD COLUMN IF NOT EXISTS signature_key text,
  ADD COLUMN IF NOT EXISTS signed_at     timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plugin_catalog_signature_chk') THEN
    ALTER TABLE plugin_catalog ADD CONSTRAINT plugin_catalog_signature_chk
      CHECK ((signature IS NULL) = (signature_key IS NULL) AND (signature IS NULL) = (signed_at IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plugin_catalog_signature_key_chk') THEN
    ALTER TABLE plugin_catalog ADD CONSTRAINT plugin_catalog_signature_key_chk
      CHECK (signature_key IS NULL OR signature_key ~ '^ed25519:[0-9a-f]{16}$');
  END IF;
END $$;

COMMENT ON COLUMN plugin_catalog.signature IS
  'base64 Ed25519 signature over (package, version, hash, grant), canonical JSON (src/plugins/signature.ts), made by the console at approval. The loader verifies it as well as the hash (ADR-015).';
COMMENT ON COLUMN plugin_catalog.signature_key IS
  'The id of the catalog key that made the signature: ed25519: and the first 16 hex of the sha256 of its public key (DER).';
COMMENT ON COLUMN plugin_catalog.signed_at IS
  'When the signature was made.';
