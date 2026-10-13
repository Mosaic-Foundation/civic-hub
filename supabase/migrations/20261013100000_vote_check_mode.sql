-- Actions slice: how a vote's receipt check answers (additive).
--
-- After a vote closes, anyone with a receipt code can check it. A vote's
-- creator chooses, on the draft, how the check answers:
--   show_choice:  "A ballot with this code was counted in <vote>, for
--                 <option>." The public vote log lists codes with choices,
--                 as every vote's log did before this.
--   counted_only: "A ballot with this code was counted in <vote>." The log
--                 lists codes only; the choice is never shown by code.
-- The vote carries the mode in its state from approval on, fixed from then.
-- null on a draft: the hub's default for new votes (show_choice unless an
-- admin set another), applied when the draft is submitted.
--
-- Named check_mode, not receipt_*: no column outside vote_records may name a
-- receipt (tests/fixtures/ballotSecrecyRules.ts). It is a draft setting and
-- links no one to anything.

ALTER TABLE vote_drafts ADD COLUMN IF NOT EXISTS check_mode text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vote_drafts_check_mode_valid'
  ) THEN
    ALTER TABLE vote_drafts
      ADD CONSTRAINT vote_drafts_check_mode_valid
      CHECK (check_mode IS NULL OR check_mode IN ('show_choice', 'counted_only'));
  END IF;
END $$;

COMMENT ON COLUMN vote_drafts.check_mode IS
  'How the receipt check answers once the vote closes: show_choice or counted_only; null = the hub default at submit.';

NOTIFY pgrst, 'reload schema';
