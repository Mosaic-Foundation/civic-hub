-- Beta waitlist: optional name.
--
-- The form asked for an email and a note, so every signup notification led
-- with a bare address. A name costs the visitor nothing (never required) and
-- gives the operator the one piece of context that makes triage feel like
-- reading about a person rather than a row.
--
-- Nullable on purpose: blank stays NULL rather than empty string, so "no name
-- given" is one value everywhere instead of two.

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS name TEXT;
