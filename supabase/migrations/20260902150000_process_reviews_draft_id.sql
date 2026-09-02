-- A review remembers the draft it was submitted from, so "Edit & resubmit"
-- can reopen the creator's real drafting form (banner, sources, options,
-- seeds, links — everything) instead of a title/description box. Nullable:
-- reviews created before this (or by a type without drafts) keep the inline
-- fallback. Set by submitForReview when the submitting controller passes
-- draft_id; read by POST /reviews/:id/reopen.
--
-- Apply to prod BEFORE deploying the code that writes it.

BEGIN;

ALTER TABLE process_reviews
  ADD COLUMN IF NOT EXISTS draft_id TEXT;

COMMIT;
