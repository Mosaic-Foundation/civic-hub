-- Audit 1, live exposure (2026-10-11). Three changes, one migration.
--
-- NOT ADDITIVE (Adam approved 2026-10-11): parts 1 and 2 replace existing
-- functions and rewrite existing rows. Part 3 is additive.
--
-- 1. SEARCH SEES ONLY WHAT IS PUBLIC (audit A2).
--    search_doc was to_tsvector(title || description || state::text), so a
--    brief's recipient emails, admin notes and draft bodies were matchable,
--    and search_processes returned any active/closed/finalized row, so a brief
--    or vote result awaiting approval, or a meeting summary not yet approved,
--    was found by anyone. Now:
--      - the document is built from each type's PUBLIC text only
--        (_civic_public_search_text), and a brief / vote result / meeting
--        summary indexes nothing until it is published;
--      - both RPCs also require publication for those three types, so the
--        rule holds even for a row whose document is stale;
--      - every existing row's document is rebuilt. The updated_at trigger is
--        held off for that statement so no process looks "updated today".
--    The type list below names only process types, never places. A new type
--    indexes its title and description until it is given a branch here.
--
-- 2. ANONYMOUS STAYS ANONYMOUS (audit A8).
--    Hiding or restoring a comment wrote comment_author_id into a restricted
--    event even when the comment was anonymous. The code no longer writes it;
--    this removes it from the events already in the log, for anonymous
--    comments only. events refuses UPDATE (events_no_update); the trigger is
--    disabled for the one statement and re-enabled in the same transaction,
--    the pattern of 20260926030000.
--
-- 3. THE CODE OF CONDUCT CHECK IS TIED TO THE TEXT IT SAW (audit A4).
--    coc_checked_hash on the four drafts tables: a SHA-256 of the checked
--    fields as the check read them, written with the check's result. Submit
--    requires the draft's current fields to hash to it, so a check cannot be
--    skipped (the client no longer sends skip_modified_flag) and an autosave
--    that lands while the check runs is not covered by its pass. Null for
--    drafts checked before this release: they run the check once more.

BEGIN;

-- 1. Search ------------------------------------------------------------------

-- Every string value anywhere inside a JSON value, space-joined, each once
-- (strict mode: lax would visit array elements twice). Only called
-- on paths that are public in their entirety.
CREATE OR REPLACE FUNCTION public._civic_json_strings(j jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(string_agg(v #>> '{}', ' '), '')
  FROM jsonb_path_query(coalesce(j, 'null'::jsonb), 'strict $.** ? (@.type() == "string")') AS v;
$$;

-- The public text of one process row, by type. Paths follow each type's
-- public read model; anything an admin-only screen shows (recipients,
-- delivery reports, moderation reasons, supporters, AI instructions,
-- unreviewed revisions, Polis ids) is left out by not being named.
CREATE OR REPLACE FUNCTION public._civic_public_search_text(
  p_type text,
  p_title text,
  p_description text,
  p_content jsonb,
  p_state jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    -- Unpublished outcome records index nothing at all.
    WHEN p_type IN ('civic.brief', 'civic.vote_results')
         AND coalesce(p_state ->> 'publication_status', '') <> 'published' THEN ''
    WHEN p_type = 'civic.meeting_summary'
         AND coalesce(p_state ->> 'approval_status', '') <> 'published' THEN ''
    ELSE concat_ws(' ',
      p_title,
      p_description,
      CASE p_type
        WHEN 'civic.vote' THEN concat_ws(' ',
          p_content ->> 'core_question',
          p_content ->> 'key_tradeoff',
          public._civic_json_strings(p_content -> 'sections'),
          public._civic_json_strings(p_state -> 'options'))
        WHEN 'civic.announcement' THEN concat_ws(' ',
          p_state -> 'content' ->> 'title',
          p_state -> 'content' ->> 'body')
        WHEN 'civic.brief' THEN concat_ws(' ',
          p_state -> 'content' ->> 'headline',
          p_state -> 'content' ->> 'summary',
          public._civic_json_strings(p_state -> 'content' -> 'sections'),
          public._civic_json_strings(p_state -> 'content' -> 'comments'),
          p_state -> 'content' ->> 'admin_notes')
        WHEN 'civic.vote_results' THEN concat_ws(' ',
          public._civic_json_strings(p_state -> 'content' -> 'comments'),
          p_state -> 'content' ->> 'admin_notes',
          p_state -> 'content' -> 'vote_context' ->> 'description',
          p_state -> 'content' -> 'vote_context' -> 'content' ->> 'core_question',
          p_state -> 'content' -> 'vote_context' -> 'content' ->> 'key_tradeoff',
          public._civic_json_strings(p_state -> 'content' -> 'vote_context' -> 'content' -> 'sections'),
          public._civic_json_strings(jsonb_path_query_array(p_state -> 'content' -> 'vote_context' -> 'options', 'lax $[*].option_label')))
        WHEN 'civic.meeting_summary' THEN concat_ws(' ',
          p_state ->> 'meeting_title',
          public._civic_json_strings(jsonb_path_query_array(p_state -> 'blocks', 'lax $[*].topic_title')),
          public._civic_json_strings(jsonb_path_query_array(p_state -> 'blocks', 'lax $[*].topic_summary')),
          public._civic_json_strings(jsonb_path_query_array(p_state -> 'blocks', 'lax $[*].action_taken')),
          p_state ->> 'admin_notes')
        WHEN 'civic.polis_deliberation' THEN concat_ws(' ',
          p_state ->> 'topic',
          p_state ->> 'framing',
          p_state -> 'summary' ->> 'summary_text')
        WHEN 'civic.wordcloud' THEN
          public._civic_json_strings(jsonb_path_query_array(p_state -> 'prompts', 'lax $[*].text'))
        ELSE ''
      END)
  END;
$$;

CREATE OR REPLACE FUNCTION processes_update_search_doc()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_doc := to_tsvector('english',
    public._civic_public_search_text(NEW.type, NEW.title, NEW.description, NEW.content, NEW.state));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- content joins the column list: a vote's public text lives there.
DROP TRIGGER IF EXISTS processes_search_doc_trigger ON processes;
CREATE TRIGGER processes_search_doc_trigger
  BEFORE INSERT OR UPDATE OF type, title, description, content, state
  ON processes
  FOR EACH ROW
  EXECUTE FUNCTION processes_update_search_doc();

ALTER TABLE processes DISABLE TRIGGER processes_updated_at;
UPDATE processes
SET search_doc = to_tsvector('english',
  public._civic_public_search_text(type, title, description, content, state));
ALTER TABLE processes ENABLE TRIGGER processes_updated_at;

-- The publication rule, shared by both RPCs.
CREATE OR REPLACE FUNCTION public._civic_search_publishable(p_type text, p_state jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_type IN ('civic.brief', 'civic.vote_results')
      THEN coalesce(p_state ->> 'publication_status', '') = 'published'
    WHEN p_type = 'civic.meeting_summary'
      THEN coalesce(p_state ->> 'approval_status', '') = 'published'
    ELSE true
  END;
$$;

CREATE OR REPLACE FUNCTION public.search_processes(
  p_hub_id text,
  p_q text,
  p_types text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_sort text DEFAULT 'relevance',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(id text, type text, title text, description text, status text, state jsonb, created_at timestamptz, rank real)
LANGUAGE sql
STABLE
AS $function$
  WITH q AS (
    SELECT websearch_to_tsquery('english', p_q) AS query
  )
  SELECT
    p.id,
    p.type,
    p.title,
    p.description,
    p.status::text,
    p.state,
    p.created_at,
    ts_rank(p.search_doc, q.query) AS rank
  FROM processes p, q
  WHERE
    p.hub_id = p_hub_id
    AND p.search_doc @@ q.query
    AND p.status IN ('active', 'closed', 'finalized')
    AND public._civic_search_publishable(p.type, p.state)
    AND (
      p.state -> 'moderation' ->> 'removed' IS NULL
      OR p.state -> 'moderation' ->> 'removed' = 'false'
    )
    AND (p_types IS NULL OR p.type = ANY(p_types))
    AND (p_from IS NULL OR p.created_at >= p_from)
    AND (p_to   IS NULL OR p.created_at <= p_to)
  ORDER BY
    CASE WHEN p_sort = 'newest' THEN NULL ELSE ts_rank(p.search_doc, q.query) END DESC NULLS LAST,
    CASE WHEN p_sort = 'newest' THEN p.created_at ELSE NULL END DESC NULLS LAST,
    p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$function$;

CREATE OR REPLACE FUNCTION public.search_processes_count(
  p_hub_id text,
  p_q text,
  p_types text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
AS $function$
  WITH q AS (
    SELECT websearch_to_tsquery('english', p_q) AS query
  )
  SELECT count(*)::bigint
  FROM processes p, q
  WHERE
    p.hub_id = p_hub_id
    AND p.search_doc @@ q.query
    AND p.status IN ('active', 'closed', 'finalized')
    AND public._civic_search_publishable(p.type, p.state)
    AND (
      p.state -> 'moderation' ->> 'removed' IS NULL
      OR p.state -> 'moderation' ->> 'removed' = 'false'
    )
    AND (p_types IS NULL OR p.type = ANY(p_types))
    AND (p_from IS NULL OR p.created_at >= p_from)
    AND (p_to   IS NULL OR p.created_at <= p_to);
$function$;

-- 2. Anonymous comment moderation events ---------------------------------------

ALTER TABLE events DISABLE TRIGGER events_no_update;
UPDATE events e
SET data = e.data #- '{moderation,target,comment_author_id}'
WHERE e.event_type = 'civic.process.updated'
  AND e.data -> 'moderation' ->> 'action' IN ('comment_hidden', 'comment_restored')
  AND e.data -> 'moderation' -> 'target' ? 'comment_author_id'
  AND EXISTS (
    SELECT 1 FROM community_inputs ci
    WHERE ci.hub_id = e.hub_id
      AND ci.id = e.data -> 'moderation' -> 'target' ->> 'comment_id'
      AND ci.is_anonymous
  );
ALTER TABLE events ENABLE TRIGGER events_no_update;

-- 3. The Code of Conduct check's hash -----------------------------------------

ALTER TABLE proposal_drafts     ADD COLUMN IF NOT EXISTS coc_checked_hash text;
ALTER TABLE vote_drafts         ADD COLUMN IF NOT EXISTS coc_checked_hash text;
ALTER TABLE project_drafts      ADD COLUMN IF NOT EXISTS coc_checked_hash text;
ALTER TABLE deliberation_drafts ADD COLUMN IF NOT EXISTS coc_checked_hash text;

COMMENT ON COLUMN proposal_drafts.coc_checked_hash IS
  'SHA-256 of the checked fields as the Code of Conduct check read them. Submit requires the current fields to match.';
COMMENT ON COLUMN vote_drafts.coc_checked_hash IS
  'SHA-256 of the checked fields as the Code of Conduct check read them. Submit requires the current fields to match.';
COMMENT ON COLUMN project_drafts.coc_checked_hash IS
  'SHA-256 of the checked fields as the Code of Conduct check read them. Submit requires the current fields to match.';
COMMENT ON COLUMN deliberation_drafts.coc_checked_hash IS
  'SHA-256 of the checked fields as the Code of Conduct check read them. Submit requires the current fields to match.';

COMMIT;
