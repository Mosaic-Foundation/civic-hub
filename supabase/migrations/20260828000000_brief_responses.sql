-- =====================================================================
-- brief_responses — public official responses to published Civic Briefs
-- =====================================================================
-- A published brief is a SEALED record (its state stops being editable
-- the moment it publishes), so an official's response is not a mutation
-- of the brief — it is its own first-class row, appended alongside it.
-- Append-only public correspondence: no edit or delete path by design;
-- a follow-up is a new row, the way letters on the record work.
--
--   responder_id     the official's ACCOUNT (users.id) — responses are
--                    authored by accounts, the same way every other
--                    surface resolves an author.
--   official_type /  SNAPSHOT of the office held AT RESPONSE TIME, so a
--   official_title   response keeps rendering the office it was made
--                    under even if the account is later demoted or the
--                    title changes. Mirrors how announcements stamp
--                    author_role at post time.
--   feed_anchor      true on the response that carries the feed card.
--                    At most one anchor per brief per rolling 24h: the
--                    write path anchors a response only when no other
--                    anchor for the brief exists in the last 24 hours,
--                    so five responses in an afternoon are five rows on
--                    the record but ONE card in the feed/digest. The
--                    event log itself is never throttled — every
--                    response emits its event; feed-worthiness reads
--                    this flag (stamped into the event payload).
--
-- Multiple responses per official are allowed on purpose (no unique
-- constraint on (brief_id, responder_id)): "responded Tuesday, added a
-- clarification after Thursday's meeting" is the real-world pattern.
--
-- Apply via Supabase -> SQL Editor (dev first, then prod).
-- MUST be applied to prod BEFORE the code that writes brief_responses
-- deploys (per the 08-22 incident: a shared `main` means the migration
-- must not trail its writer). Reads degrade to "no responses" against a
-- database missing this table; writes fail loudly.
-- Verify with:
--   SELECT to_regclass('public.brief_responses') IS NOT NULL AS table_ready;
-- Expect: t.

BEGIN;

CREATE TABLE IF NOT EXISTS brief_responses (
  id             TEXT PRIMARY KEY,
  brief_id       TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  responder_id   TEXT NOT NULL REFERENCES users(id),
  official_type  TEXT NOT NULL,
  official_title TEXT NOT NULL,
  body           TEXT NOT NULL,
  feed_anchor    BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Same office vocabulary as users_official_type_chk; a snapshot must
  -- still be a recognized kind so pill colouring never sees garbage.
  CONSTRAINT brief_responses_type_vocab
    CHECK (official_type IN (
      'board_of_supervisors',
      'town_council',
      'planning_commission',
      'school_board',
      'other'
    )),

  -- The title is the half that renders; an empty one is not a response
  -- from an office. Body bounds match the app-layer validation.
  CONSTRAINT brief_responses_title_nonempty
    CHECK (length(trim(official_title)) > 0),
  CONSTRAINT brief_responses_body_bounds
    CHECK (length(body) BETWEEN 1 AND 5000)
);

-- Every public brief read fetches its responses; the anchor lookup asks
-- "latest anchor for this brief" — both are served by brief_id-first
-- indexes.
CREATE INDEX IF NOT EXISTS idx_brief_responses_brief
  ON brief_responses (brief_id, created_at);
CREATE INDEX IF NOT EXISTS idx_brief_responses_anchor
  ON brief_responses (brief_id, created_at DESC)
  WHERE feed_anchor;

-- Project convention: ENABLE + FORCE with zero policies = deny-all to
-- anon. The backend uses the service-role key, which bypasses RLS.
ALTER TABLE brief_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE brief_responses FORCE  ROW LEVEL SECURITY;

COMMENT ON TABLE brief_responses IS
  'Public, append-only official responses to published civic.brief processes. official_type/official_title snapshot the office held at response time; feed_anchor marks the (at most) one response per brief per 24h that carries the feed card.';

COMMIT;
