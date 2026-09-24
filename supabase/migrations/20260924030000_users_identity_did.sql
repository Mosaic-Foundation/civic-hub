-- users.identity_did — reserved, nothing reads it (Phase 2a).
--
-- ADR-004 (../decisions/2026-09-22-multi-tenant.md): one user row per hub,
-- with a reserved identity_did column as the seam for portable identity.
-- A person with accounts on two hubs has two rows; when DID sign-in arrives
-- (Phase 2 of the wider roadmap), the rows that belong to one person share a
-- DID here, without merging accounts or moving any hub's data.
--
-- Nullable, no default, no index and no uniqueness yet: which of those it
-- needs depends on how DIDs are verified, which is not decided. Additive.

ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_did TEXT;

GRANT SELECT, INSERT, UPDATE, DELETE ON users TO authenticated, service_role;

COMMENT ON COLUMN users.identity_did IS
  'Reserved for portable identity (ADR-004). Nothing reads or writes it yet.';
