-- Persistent user opt-out for AI drafting help.
--
-- When true, the assistant affordance is removed from every process
-- creation flow for this user, on every device. It does NOT disable the
-- always-on automated Code of Conduct check — that runs on every
-- submission regardless.
--
-- Apply by hand in the Supabase SQL editor, DEV FIRST (the CLI link
-- points at prod — do not `db push`). Code reads degrade gracefully
-- against an un-migrated database (the setting reads as false); the
-- write fails loudly on purpose.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hide_ai_drafting_help BOOLEAN NOT NULL DEFAULT FALSE;
