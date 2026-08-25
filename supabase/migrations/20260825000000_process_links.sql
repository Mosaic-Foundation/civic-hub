-- Light process-linking (Batch A #8).
--
-- ONE ROW PER RELATIONSHIP. The edge is stored once, in the direction the
-- author asserted it (from_id -> to_id). The backlink is DERIVED by querying
-- to_id, never written. That is the whole point: a backlink cannot drift from
-- its forward link, because there is nothing to keep in sync.
--
-- Deliberately type-agnostic: from_id/to_id reference processes(id) with no
-- notion of what kind of process either end is. A process type added years
-- from now is linkable the day it is registered, with no change to this table.
--
-- Visibility is INHERITED, not stored. There is no status/approved column
-- here. A link renders only when the process it hangs off is itself publicly
-- visible, so a resident's proposed links stay invisible while their
-- submission sits in pending_review, and go live when an admin approves it.
-- The review flow already governs that; duplicating it here would create a
-- second state machine to keep honest.
--
-- Apply via Supabase -> SQL Editor (dev first, then prod).
-- MUST be applied to prod BEFORE the code that writes process_links deploys.
-- Verify with:
--   SELECT to_regclass('public.process_links') IS NOT NULL AS table_ready;
-- Expect: t.

BEGIN;

-- 1. The edge table ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS process_links (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  relation   TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The relation vocabulary, enforced at the storage layer so a bad write
  -- from any path (app, script, SQL console) is refused rather than stored.
  CONSTRAINT process_links_relation_vocab
    CHECK (relation IN ('continues', 'references', 'implements')),

  -- A process cannot relate to itself.
  CONSTRAINT process_links_no_self
    CHECK (from_id <> to_id)
);

-- Idempotence: re-asserting the same edge is a no-op, not a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_process_links_edge
  ON process_links (from_id, to_id, relation);

-- Both directions are read on every process detail page, so both get an index.
-- The to_id index is what makes backlinks cheap.
CREATE INDEX IF NOT EXISTS idx_process_links_from ON process_links (from_id);
CREATE INDEX IF NOT EXISTS idx_process_links_to   ON process_links (to_id);

-- Project convention: ENABLE + FORCE with zero policies = deny-all to anon.
-- The backend uses the service-role key, which bypasses RLS.
ALTER TABLE process_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_links FORCE  ROW LEVEL SECURITY;

-- 2. Links carried on a draft ------------------------------------------------
--
-- A resident picks related processes while composing, before any process row
-- exists to hang an edge off. The draft holds them as jsonb until submission,
-- at which point submitForReview() materializes them into process_links.
-- Shape: [{ "to_id": "proc_x", "relation": "continues" }]

ALTER TABLE proposal_drafts
  ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE vote_drafts
  ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE project_drafts
  ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
