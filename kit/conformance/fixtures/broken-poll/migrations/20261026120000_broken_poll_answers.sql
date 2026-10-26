-- THE DELIBERATE DEFECT (kit/conformance/fixtures/broken-poll): the straw
-- poll's table without its one-answer-per-resident key, so a resident can
-- answer twice. The conformance suite must fail it (step 4b: an action
-- declared once_per_participant lets a person through once).

CREATE TABLE IF NOT EXISTS public.broken_poll_answers (
  hub_id     text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  process_id text        NOT NULL,
  user_id    text        NOT NULL,
  choice     text        NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  id         bigserial   NOT NULL,
  PRIMARY KEY (hub_id, id)
);

COMMENT ON TABLE public.broken_poll_answers IS
  'The broken copy of the straw poll example''s answers (docs/BUILD-A-PLUGIN.md): one per resident per poll; only counts are published.';

SELECT public._civic_apply_hub_policy('public.broken_poll_answers');
