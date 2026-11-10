-- Drop the legacy vote bridge (console slice, 2026-11-10). NOT ADDITIVE:
-- Adam approved this drop by name.
--
-- active_vote_keys linked a voter to their receipt while a vote was open,
-- until ballot secrecy at rest (20261010000000) moved the receipt to the
-- voter's browser. Since then nothing wrote it: cast_vote, its last writer,
-- was kept only for that deploy window, and claim_vote_key let a voter from
-- before the change collect their key once. Production held 0 rows on
-- 2026-11-10 (Adam: select count(*) from active_vote_keys), and the code
-- that read or cleared it (the vote's claim-receipt route, the close's
-- clear, the hourly job's archived-vote drain) left with Votes 0.3.0.
--
-- The functions go first: claim_vote_key reads the table. Policies, grants
-- and indexes on the table go with it. IF EXISTS so a database that never
-- had one of them (a fresh test stack built after a squash) runs it too.

DROP FUNCTION IF EXISTS public.claim_vote_key(text, text, text, text);
DROP FUNCTION IF EXISTS public.cast_vote(text, text, text, text, jsonb);
DROP TABLE IF EXISTS public.active_vote_keys;
