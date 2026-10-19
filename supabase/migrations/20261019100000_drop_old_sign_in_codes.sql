-- Drop the pre-2026-10-13 sign-in code tables and their attempt functions.
-- NOT additive: this deletes three tables and three functions. Adam's yes,
-- 2026-10-17, after the production count below. Its release notes must say
-- it is non-additive.
--
-- Dated after 20261019000000 (the dashboard's job_last_run): first written as
-- 20261018020000, which the CLI would refuse once a later migration was in.
--
-- 20261014000000_sign_in_codes.sql moved every sign-in code to sign_in_codes
-- (a hub's) and platform_sign_in_codes (the console's and the start page's)
-- and said a later migration would drop the old three. This is that migration.
-- Nothing in src/ has read or written pending_verifications, control_codes or
-- start_codes since 20261014000000, and nothing calls take_code_attempt,
-- take_control_code_attempt or take_start_code_attempt.
--
-- Pre-checks: none of the three may hold an unexpired row. Dev, 2026-10-16:
-- pending_verifications 1 row, expired (2026-10-12); control_codes 0;
-- start_codes 0. Production, 2026-10-17 (Adam): pending_verifications 2 rows,
-- newest 2026-10-12, none unexpired; control_codes 0; start_codes 0. Re-count
-- on production just before applying it there. No view, function or
-- trigger depends on them (grepped the migrations), so there is no CASCADE.
--
-- Never raises 40001.

DROP FUNCTION IF EXISTS public.take_code_attempt(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.take_control_code_attempt(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.take_start_code_attempt(text, integer, integer);

DROP TABLE IF EXISTS pending_verifications;
DROP TABLE IF EXISTS control_codes;
DROP TABLE IF EXISTS start_codes;

NOTIFY pgrst, 'reload schema';
