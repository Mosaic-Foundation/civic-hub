-- THE DELIBERATE DEFECT (kit/conformance/fixtures/not-additive): a second
-- migration that drops a column the version before reads. Every hub shares
-- the database, so catalog:add and civic-conformance refuse it before running
-- anything (src/plugins/additive.ts; ADR-015).

ALTER TABLE public.not_additive_answers DROP COLUMN IF EXISTS answered_at;
