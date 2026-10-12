-- Submit and save: a submission the Code of Conduct check flagged (additive).
--
-- Submit now runs the Code of Conduct check. When it finds a problem, nothing
-- is submitted, unless the resident chooses "Think this is wrong? Tell the
-- admins": then the submission goes to the review queue as it is, with the
-- check's findings here so the admin sees what was flagged. The resident's
-- optional note is the first review turn's existing `note`.
--
-- null: not flagged (every row before this, and every clean submission). A
-- revision that passes the check clears it; one still flagged rewrites it.
-- Never auto-approved while set: not for an admin, not on a demo hub.

ALTER TABLE process_reviews ADD COLUMN IF NOT EXISTS coc_flags jsonb;

COMMENT ON COLUMN process_reviews.coc_flags IS
  'The Code of Conduct check''s findings when the resident sent a flagged submission to the admins; null when not flagged.';

NOTIFY pgrst, 'reload schema';
