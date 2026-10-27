-- The straw poll's answers: one per resident per poll. Additive (a new table),
-- under the hub's row-level security template like every hub table.

CREATE TABLE IF NOT EXISTS public.not_additive_answers (
  hub_id     text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  process_id text        NOT NULL,
  user_id    text        NOT NULL,
  choice     text        NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, process_id, user_id)
);

COMMENT ON TABLE public.not_additive_answers IS
  'The straw poll example package''s answers (docs/BUILD-A-PLUGIN.md): one per resident per poll; only counts are published.';

SELECT public._civic_apply_hub_policy('public.not_additive_answers');

-- Granted to the hub's roles here, as every hub migration does: a local or CI
-- stack gives a new table no privileges by default (20260922000000).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.not_additive_answers TO authenticated, service_role;
  END IF;
END $$;
