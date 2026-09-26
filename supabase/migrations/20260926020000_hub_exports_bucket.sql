-- Phase 5 part two: the private bucket the console's "Export this hub" writes
-- to (BUILD-PLAN-multi-tenant.md → Phase 5 → "Part two").
--
-- An export is a whole hub's data — residents' emails included — so this
-- bucket is PRIVATE and has NO policies: only the service role (the super
-- admin, src/control/) reaches it. The operator downloads through a signed
-- URL that lives about ten minutes. The console cannot stream the archive
-- itself because Vercel caps a function response at 4.5 MB.
--
-- Objects live under `<hub_id>/civic-hub-export-<hub_id>-<stamp>.tar.gz` and
-- are deleted 24 hours after they were written by the `hub_exports_sweep`
-- job (src/jobs/registry.ts). The audit row (`hub.export`) stays.
--
-- Additive, and PORTABLE like 20260924070000: skips with a NOTICE where there
-- is no storage schema (plain Postgres). ON CONFLICT DO NOTHING keeps a bucket
-- someone made by hand exactly as it is. Production: after 20260926010000.

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'hub-exports: no storage schema here; bucket skipped';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
  VALUES ('hub-exports', 'hub-exports', false, ARRAY['application/gzip'])
  ON CONFLICT (id) DO NOTHING;
END $$;
