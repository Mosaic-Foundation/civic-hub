-- =====================================================================
-- users — admin-managed "official" role with a structured title
-- =====================================================================
-- Generalizes the env-managed board author (CIVIC_BOARD_EMAILS) and the
-- email-keyed hub_settings.announcement_authors blob into a per-user,
-- id-keyed record that any surface can render.
--
--   official_type   coarse machine-readable kind, for per-type pill
--                   colour and future filtering. Adding a kind = extend
--                   the CHECK below + OFFICIAL_TYPES in
--                   src/shared/officialTypes.ts. No data migration.
--   official_title  the human string actually rendered in the pill
--                   ("Board of Supervisors", "Supervisor, District 3").
--
-- Columns rather than a join table: one office per account, no history
-- requirement, and creatorDisplay.resolveCreators() keeps its single
-- batched `select("*")` over users — no join, no N+1.
--
-- Deploy order: apply this BEFORE shipping the code that writes the
-- columns. Per the 08-22 incident, a shared `main` means the migration
-- must not trail its writer.
--
-- Safe on a running system: both columns are nullable with no default,
-- so every existing row already satisfies the constraints and the
-- revalidation scan cannot fail. Re-runnable — the ADDs are guarded and
-- the constraints are dropped first.
--
-- Note: creatorDisplay reads users with `select("*")` specifically so
-- that a database which has NOT applied this migration degrades to
-- "no title" instead of hard-erroring on a missing column.
-- =====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS official_type  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS official_title TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_official_type_chk;
ALTER TABLE users
  ADD CONSTRAINT users_official_type_chk
    CHECK (official_type IS NULL OR official_type IN (
      'board_of_supervisors',
      'town_council',
      'planning_commission',
      'school_board',
      'other'
    ));

-- Both or neither: a type with no title has nothing to render, and a
-- title with no type cannot be coloured or filtered.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_official_pair_chk;
ALTER TABLE users
  ADD CONSTRAINT users_official_pair_chk
    CHECK ((official_type IS NULL) = (official_title IS NULL));

-- Partial index: the officials are a handful of rows in a table of
-- residents, and every query against them is "who are the officials".
CREATE INDEX IF NOT EXISTS users_official_idx
  ON users (official_type)
  WHERE official_type IS NOT NULL;

COMMENT ON COLUMN users.official_type IS
  'Coarse official kind: board_of_supervisors | town_council | planning_commission | school_board | other. NULL for residents. Drives pill colour; the rendered text is official_title.';
COMMENT ON COLUMN users.official_title IS
  'Human-facing office title rendered as a pill next to this user''s name wherever they post. NULL for residents.';
