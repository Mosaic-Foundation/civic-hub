-- Audit 3, part two: one review per draft (additive).
--
-- Every drafting kind now claims its draft before submitting it (the
-- conditional drafting → submitted update proposals already had), so a double
-- click or two tabs cannot create two reviews. This index is the database's
-- own guarantee behind that claim: a draft is in the review queue at most once
-- per hub. A revision rewrites the existing review; it never adds one.
--
-- Dev (production-shaped) had no draft with two reviews on 2026-10-11; check
-- production with the query in the Audit 3 report before applying.

CREATE UNIQUE INDEX IF NOT EXISTS process_reviews_one_per_draft
  ON process_reviews (hub_id, draft_id)
  WHERE draft_id IS NOT NULL;
