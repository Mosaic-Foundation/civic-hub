-- One transaction for a submission (Architecture 5, ADR-012; audit F3).
--
-- submitForReview (src/modules/civic.review/service.ts) used to write five
-- things in five requests: the process, its links, the review, the process's
-- back-link to the review, the first turn, then the event. A failure between
-- them left a process with no review (invisible to the queue) or a review
-- with no turn. This writes them all, with the `civic.review.submitted`
-- event built by buildEvent() (the one emission path), or none of them.
--
-- Links stay best-effort, as they were: a link whose target is gone (or not
-- on this hub), or that already exists, is skipped, never fatal; the count
-- of skipped links comes back so the caller can say so in its log. The
-- caller validates the link set first (validateLinkSet) and passes none
-- when it is invalid.
--
-- Additive: a new function only. Old code keeps working (it never calls it).
-- Raises 42501 when a row names another hub; never 40001.

CREATE OR REPLACE FUNCTION public.submit_for_review(
  p_hub_id text,
  p_process jsonb,
  p_review jsonb,
  p_turn jsonb,
  p_links jsonb,
  p_event jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_process_id text := p_process->>'id';
  v_review_id text := p_review->>'id';
  v_link jsonb;
  v_skipped integer := 0;
  v_count integer;
  v_review process_reviews%ROWTYPE;
BEGIN
  IF v_process_id IS NULL OR v_review_id IS NULL THEN
    RAISE EXCEPTION 'submit_for_review: the process and the review need ids' USING ERRCODE = '22023';
  END IF;
  IF p_review->>'process_id' IS DISTINCT FROM v_process_id THEN
    RAISE EXCEPTION 'submit_for_review: the review is for process %, not %', p_review->>'process_id', v_process_id
      USING ERRCODE = '22023';
  END IF;
  IF p_turn->>'review_id' IS DISTINCT FROM v_review_id THEN
    RAISE EXCEPTION 'submit_for_review: the turn is for review %, not %', p_turn->>'review_id', v_review_id
      USING ERRCODE = '22023';
  END IF;

  -- 1. The process, pending review, not yet pointing at its review (the
  --    foreign key needs the review first).
  INSERT INTO processes (
    id, type, process_version, title, description, jurisdiction, status,
    content, config, state, created_by, is_sample, added_in_demo, hub_id
  ) VALUES (
    v_process_id,
    p_process->>'type',
    coalesce(p_process->>'process_version', '0.1'),
    p_process->>'title',
    p_process->>'description',
    p_process->>'jurisdiction',
    p_process->>'status',
    CASE WHEN jsonb_typeof(p_process->'content') = 'null' THEN NULL ELSE p_process->'content' END,
    CASE WHEN jsonb_typeof(p_process->'config') = 'null' THEN NULL ELSE p_process->'config' END,
    coalesce(p_process->'state', '{}'::jsonb),
    p_process->>'created_by',
    coalesce((p_process->>'is_sample')::boolean, false),
    coalesce((p_process->>'added_in_demo')::boolean, false),
    p_hub_id
  );

  -- 2. Its links, best-effort: only to a process on this hub, never twice.
  IF p_links IS NOT NULL AND jsonb_typeof(p_links) = 'array' THEN
    FOR v_link IN SELECT value FROM jsonb_array_elements(p_links) LOOP
      INSERT INTO process_links (id, from_id, to_id, to_iri, relation, created_by, hub_id)
      SELECT v_link->>'id', v_process_id, v_link->>'to_id', v_link->>'to_iri', v_link->>'relation',
             v_link->>'created_by', p_hub_id
       WHERE EXISTS (SELECT 1 FROM processes WHERE hub_id = p_hub_id AND id = v_link->>'to_id')
         AND v_link->>'to_id' IS DISTINCT FROM v_process_id
         AND v_link->>'relation' IN ('continues', 'references', 'implements')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count = 0 THEN
        v_skipped := v_skipped + 1;
      END IF;
    END LOOP;
  END IF;

  -- 3. The review.
  INSERT INTO process_reviews (id, process_id, draft_id, creator_id, creator_name, creator_email, status, coc_flags, hub_id)
  VALUES (
    v_review_id,
    v_process_id,
    p_review->>'draft_id',
    p_review->>'creator_id',
    p_review->>'creator_name',
    p_review->>'creator_email',
    coalesce(p_review->>'status', 'pending_review'),
    CASE WHEN p_review ? 'coc_flags' AND jsonb_typeof(p_review->'coc_flags') <> 'null' THEN p_review->'coc_flags' END,
    p_hub_id
  )
  RETURNING * INTO v_review;

  -- 4. The process points at its review.
  UPDATE processes SET review_id = v_review_id WHERE id = v_process_id AND hub_id = p_hub_id;

  -- 5. The first turn.
  INSERT INTO review_turns (id, review_id, turn_number, actor, actor_role, action, note, process_snapshot, hub_id)
  VALUES (
    p_turn->>'id',
    v_review_id,
    coalesce((p_turn->>'turn_number')::integer, 1),
    p_turn->>'actor',
    p_turn->>'actor_role',
    p_turn->>'action',
    p_turn->>'note',
    CASE WHEN jsonb_typeof(p_turn->'process_snapshot') = 'null' THEN NULL ELSE p_turn->'process_snapshot' END,
    p_hub_id
  );

  -- 6. The event, as buildEvent() made it.
  PERFORM _civic_insert_event(p_hub_id, v_process_id, NULL, p_event);

  RETURN jsonb_build_object('review', to_jsonb(v_review), 'links_skipped', v_skipped);
END;
$$;

COMMENT ON FUNCTION public.submit_for_review(text, jsonb, jsonb, jsonb, jsonb, jsonb) IS
  'A submission in one transaction: the process (pending review), its links (best-effort: a missing target or a repeat is skipped and counted), the review, the process''s link to it, the first turn and the civic.review.submitted event. Called by civic.review submitForReview through forHub().rpc().';

-- Explicit grants (20261012100000's rule): the hub's roles may call it, the
-- anonymous role and PUBLIC may not. Inside role checks, so the migrations
-- replay on a plain Postgres without Supabase's roles.
REVOKE ALL ON FUNCTION public.submit_for_review(text, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.submit_for_review(text, jsonb, jsonb, jsonb, jsonb, jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.submit_for_review(text, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.submit_for_review(text, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
