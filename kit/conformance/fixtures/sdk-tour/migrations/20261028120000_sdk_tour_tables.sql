-- The SDK tour fixture's tables. Additive (four new tables), each under the
-- hub's row-level security template and granted to the hub's roles.
--
--   sdk_tour_drafts  residents' unfinished drafts (the hub's drafts routes)
--   sdk_tour_marks   one row per resident who marked a tour (written after the action commits)
--   sdk_tour_joins   who joined each tour
--   sdk_tour_places  each tour's place as last edited (written by onEdited)

CREATE TABLE IF NOT EXISTS public.sdk_tour_drafts (
  id                          text        PRIMARY KEY,
  hub_id                      text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  user_id                     text        NOT NULL,
  title                       text        NOT NULL DEFAULT '',
  description                 text        NOT NULL DEFAULT '',
  sources                     text        NOT NULL DEFAULT '',
  place                       text,
  conversation_history        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  last_review_result          jsonb,
  draft_modified_since_review boolean     NOT NULL DEFAULT false,
  coc_checked_hash            text,
  assistant_helped            boolean     NOT NULL DEFAULT false,
  links                       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status                      text        NOT NULL DEFAULT 'drafting',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sdk_tour_drafts_hub_user_status_idx ON public.sdk_tour_drafts (hub_id, user_id, status);

CREATE OR REPLACE TRIGGER set_sdk_tour_drafts_updated_at
  BEFORE UPDATE ON public.sdk_tour_drafts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS public.sdk_tour_marks (
  hub_id     text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  process_id text        NOT NULL,
  user_id    text        NOT NULL,
  marked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, process_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.sdk_tour_joins (
  hub_id     text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  process_id text        NOT NULL,
  user_id    text        NOT NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, process_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.sdk_tour_places (
  hub_id     text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  process_id text        NOT NULL,
  place      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, process_id)
);

COMMENT ON TABLE public.sdk_tour_drafts IS 'The SDK tour fixture''s drafts, submitted through the hub''s review.';
COMMENT ON TABLE public.sdk_tour_marks IS 'The SDK tour fixture''s marks: one per resident per tour, written after the action commits.';
COMMENT ON TABLE public.sdk_tour_joins IS 'The SDK tour fixture''s joins: who joined each tour; names follow the members policy.';
COMMENT ON TABLE public.sdk_tour_places IS 'The SDK tour fixture''s place index, written when a tour is edited.';

SELECT public._civic_apply_hub_policy('public.sdk_tour_drafts');
SELECT public._civic_apply_hub_policy('public.sdk_tour_marks');
SELECT public._civic_apply_hub_policy('public.sdk_tour_joins');
SELECT public._civic_apply_hub_policy('public.sdk_tour_places');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdk_tour_drafts TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdk_tour_marks TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdk_tour_joins TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdk_tour_places TO authenticated, service_role;
  END IF;
END $$;
