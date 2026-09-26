-- Restore the vote_drafts updated_at trigger on production.
--
-- WHY. 20260524000000_vote_drafts.sql creates `set_vote_drafts_updated_at`,
-- but production does not have it: production's tables were built before the
-- CLI tracked migrations, and that one statement never reached it. Found on
-- 2026-09-25 by diffing main's 47 migrations against production's schema
-- (RUNBOOK-cutover.md → rehearsal record). Effect: `vote_drafts.updated_at`
-- never changes on production. Nothing else depends on it.
--
-- WHY IT CAME AFTER THE CUTOVER. The cutover pushed exactly the 17 rehearsed
-- migrations and checked for 17, so this file waited in
-- supabase/after-cutover/ and moved into supabase/migrations/ in the watching
-- week (RUNBOOK-cutover.md §5), for the guarded push. Until it is pushed,
-- production's history marks 20260524000000 "applied" although this trigger is
-- missing: the history claims more than the schema has.
--
-- IDEMPOTENT and additive: creates the trigger only where it is missing, so it
-- is a no-op on every database built from the migrations (dev, CI, local).

DO $$
BEGIN
  IF to_regclass('public.vote_drafts') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.vote_drafts'::regclass
         AND tgname = 'set_vote_drafts_updated_at'
         AND NOT tgisinternal
     )
  THEN
    CREATE TRIGGER set_vote_drafts_updated_at
      BEFORE UPDATE ON public.vote_drafts
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
