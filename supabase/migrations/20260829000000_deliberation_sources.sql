-- Conversations gain a Sources field (Adam, 2026-08-29).
--
-- The framing states factual table-stakes; a "learn more" list under it
-- lets participants verify them instead of taking them on faith — and
-- gives the assistant's web-search results a real home (it was offering
-- to fill a Sources field conversations didn't have).
--
-- Apply by hand in the Supabase SQL editor, DEV FIRST (the CLI link
-- points at prod — do not `db push`).

ALTER TABLE deliberation_drafts
  ADD COLUMN IF NOT EXISTS sources TEXT NOT NULL DEFAULT '';
