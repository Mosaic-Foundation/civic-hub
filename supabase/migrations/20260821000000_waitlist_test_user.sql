-- Beta waitlist: opt-in "I'd like to be a test user" flag.
--
-- Set from the checkbox on the waitlist form. Signals that the person is
-- volunteering to be approved onto the beta allowlist, so the operator can
-- triage sign-ups without reading every note. The signup notification email
-- flags it too — this column is the durable record behind that email.
--
-- Defaults FALSE so existing rows (and any client that doesn't send the
-- field) keep today's behaviour: on the list, not volunteering to test.

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS wants_test_user BOOLEAN NOT NULL DEFAULT FALSE;
