-- A vote's results from before briefs become briefs (engine 2, C; audit
-- 2026-10-10 F5). NOT ADDITIVE: it rewrites rows. Approved by Adam on
-- 2026-10-27 ("in-place conversion keeping ids, idempotent, events untouched").
--
-- Every processes row of the retired type civic.vote_results becomes a
-- civic.brief at the same id, in the same hub, with the same status (the two
-- types share their lifecycle: active while pending, finalized once
-- published, or archived) and the same publication fields (publication_status,
-- generated_at, approved_at, published_at, delivered_to, held_back). Its
-- content is rewritten into the brief's shape the way a vote's brief is made
-- (packages/civic.vote/handler.ts generateBrief: the title, "The community
-- has voted", the vote's description, a "Results" section of option, count
-- and share, "N votes cast", the comments and notes, the image). The record
-- as it was is kept whole under state.legacy_vote_results.
--
-- Events are not touched: the log is append-only, and the wire reads an
-- event's process type from its own data (civic:processType stays
-- "civic.vote_results"). The brief package declares the retired type
-- (manifest legacyTypes) so those events redact, card and count as before.
-- /vote-results/:id redirects to /brief/:id (the brief package's
-- legacyRoutes.ts and its UI route).
--
-- Idempotent: a second run finds no civic.vote_results row and changes
-- nothing. One statement; no lock beyond the rows it updates.

UPDATE public.processes AS p
SET
  type = 'civic.brief',
  state = (coalesce(p.state, '{}'::jsonb) - 'type' - 'content') || jsonb_build_object(
    'type', 'civic.brief',
    'source_process_type', 'civic.vote',
    'legacy_vote_results', coalesce(p.state -> 'content', '{}'::jsonb),
    'content', jsonb_build_object(
      'title', coalesce(p.state -> 'content' ->> 'title', p.title, ''),
      'headline', 'The community has voted',
      'summary', coalesce(p.state -> 'content' -> 'vote_context' ->> 'description', ''),
      'sections', coalesce(
        (
          SELECT jsonb_build_array(jsonb_build_object(
            'heading', 'Results',
            'body', string_agg(
              '• ' || coalesce(b ->> 'option_label', b ->> 'option_id', '') || ': ' || coalesce(b ->> 'count', '0')
                || ' (' || round(coalesce((b ->> 'percentage')::numeric, 0)) || '%)',
              E'\n' ORDER BY coalesce((b ->> 'count')::int, 0) DESC
            )
          ))
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(p.state -> 'content' -> 'position_breakdown') = 'array'
                 THEN p.state -> 'content' -> 'position_breakdown' ELSE '[]'::jsonb END
          ) AS b
          HAVING count(*) > 0
        ),
        '[]'::jsonb
      ),
      'participation_label', CASE
        WHEN p.state -> 'content' ->> 'participation_count' IS NULL THEN NULL
        ELSE (p.state -> 'content' ->> 'participation_count') || ' vote'
          || CASE WHEN p.state -> 'content' ->> 'participation_count' = '1' THEN '' ELSE 's' END || ' cast'
      END,
      'participation_count', (p.state -> 'content' ->> 'participation_count')::int,
      'comments', CASE WHEN jsonb_typeof(p.state -> 'content' -> 'comments') = 'array'
                       THEN p.state -> 'content' -> 'comments' ELSE '[]'::jsonb END,
      'admin_notes', coalesce(p.state -> 'content' ->> 'admin_notes', ''),
      'image_url', p.state -> 'content' -> 'image_url',
      'image_alt', p.state -> 'content' -> 'image_alt'
    )
  ),
  updated_at = now()
WHERE p.type = 'civic.vote_results';
