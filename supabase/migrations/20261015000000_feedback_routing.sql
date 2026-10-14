-- Feedback routing (additive): software reports reach Civic.Social, the loop closes.
--
-- Every feedback item stays with the hub (feedback_submissions, unchanged
-- rules). Bug and Idea items are also copied to Civic.Social, which maintains
-- the software, as two streams (bug, feature); an admin can forward any item
-- with "Send to Civic.Social"; and a hub admin can write to Civic.Social
-- directly (stream admin). Civic.Social's copies live in platform_feedback:
-- platform data, read and written only by the service role (src/db/
-- platformFeedback.ts, src/control/), never by a hub. Hub admins never see it.
--
-- Civic.Social's status (received, planned, fixed) is mirrored onto the hub's
-- own row (mosaic_status), so the hub's badge is read through the hub's RLS
-- like everything else on its Feedback tab.
--
-- No database functions, so no new grants on functions. No rows rewritten.

-- 1. The hub's row: what was captured, and what became of its copy -----------
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS page_path text;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS software_version text;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS contact_ok boolean NOT NULL DEFAULT false;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS mosaic_item_id text;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS mosaic_stream text;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS mosaic_status text;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS mosaic_sent_at timestamptz;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS mosaic_sent_by text;

ALTER TABLE feedback_submissions DROP CONSTRAINT IF EXISTS feedback_submissions_mosaic_stream_chk;
ALTER TABLE feedback_submissions ADD CONSTRAINT feedback_submissions_mosaic_stream_chk
  CHECK (mosaic_stream IS NULL OR mosaic_stream IN ('bug', 'feature'));
ALTER TABLE feedback_submissions DROP CONSTRAINT IF EXISTS feedback_submissions_mosaic_status_chk;
ALTER TABLE feedback_submissions ADD CONSTRAINT feedback_submissions_mosaic_status_chk
  CHECK (mosaic_status IS NULL OR mosaic_status IN ('received', 'planned', 'fixed'));
ALTER TABLE feedback_submissions DROP CONSTRAINT IF EXISTS feedback_submissions_mosaic_sent_by_chk;
ALTER TABLE feedback_submissions ADD CONSTRAINT feedback_submissions_mosaic_sent_by_chk
  CHECK (mosaic_sent_by IS NULL OR mosaic_sent_by IN ('sender', 'admin'));

COMMENT ON COLUMN feedback_submissions.page_path IS
  'The path the sender was on when they opened the form (no query string). Null before 2026-10-13.';
COMMENT ON COLUMN feedback_submissions.software_version IS
  'The deployed commit that received the item, stamped by the server.';
COMMENT ON COLUMN feedback_submissions.contact_ok IS
  'The sender ticked "Civic.Social may contact me about this". Only then does their email go with the copy.';
COMMENT ON COLUMN feedback_submissions.mosaic_item_id IS
  'The id of Civic.Social''s copy (platform_feedback.id); null when the item was not shared.';
COMMENT ON COLUMN feedback_submissions.mosaic_status IS
  'Civic.Social''s status for the copy (received, planned, fixed), mirrored here for the hub''s badge.';
COMMENT ON COLUMN feedback_submissions.mosaic_sent_by IS
  'sender: a Bug or Idea copied on submit; admin: forwarded with "Send to Civic.Social".';

-- 2. Civic.Social's inbox, across hubs ----------------------------------------
CREATE TABLE IF NOT EXISTS platform_feedback (
  id                 text        PRIMARY KEY,
  created_at         timestamptz NOT NULL DEFAULT now(),
  source_hub_id      text        NOT NULL REFERENCES hubs(id),
  source_feedback_id text,
  stream             text        NOT NULL,
  origin             text        NOT NULL,
  message            text        NOT NULL,
  page_path          text,
  user_agent         text,
  software_version   text,
  screenshot_url     text,
  contact_ok         boolean     NOT NULL DEFAULT false,
  contact_email      text,
  status             text        NOT NULL DEFAULT 'received',
  status_changed_at  timestamptz,
  github_issue_url   text,
  fixed_notified_at  timestamptz,

  CONSTRAINT platform_feedback_stream_chk CHECK (stream IN ('bug', 'feature', 'admin')),
  CONSTRAINT platform_feedback_origin_chk CHECK (origin IN ('resident', 'forwarded', 'admin')),
  CONSTRAINT platform_feedback_status_chk CHECK (status IN ('received', 'planned', 'fixed')),
  CONSTRAINT platform_feedback_message_nonempty CHECK (length(trim(message)) > 0),
  -- The privacy rule, in the database: no address without consent.
  CONSTRAINT platform_feedback_email_needs_consent CHECK (contact_email IS NULL OR contact_ok),
  CONSTRAINT platform_feedback_issue_url_chk
    CHECK (github_issue_url IS NULL OR github_issue_url ~ '^https://github\.com/[^\s]+$'),
  -- A hub item is copied once; an admin's own message has no hub item.
  CONSTRAINT platform_feedback_source_unique UNIQUE (source_hub_id, source_feedback_id)
);

CREATE INDEX IF NOT EXISTS platform_feedback_created_at_idx ON platform_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_feedback_status_idx ON platform_feedback (status, created_at DESC);

COMMENT ON TABLE platform_feedback IS
  'Civic.Social''s copies of software feedback (bug, feature) and hub admins'' messages (admin), across hubs. Platform data, not any hub''s: service role only (src/db/platformFeedback.ts, src/control/).';
COMMENT ON COLUMN platform_feedback.contact_email IS
  'The sender''s address, only when they consented (contact_ok). Null otherwise; a CHECK refuses an address without consent.';
COMMENT ON COLUMN platform_feedback.fixed_notified_at IS
  'When the consenting sender was emailed that the item is fixed; set once, so they are told once.';

ALTER TABLE platform_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_feedback FORCE ROW LEVEL SECURITY;

-- 3. Grants: the service role only --------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON platform_feedback FROM authenticated;
    -- DELETE for the smoke suite's cleanup on its own hub and a hub's purge.
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform_feedback TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON platform_feedback FROM anon;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
