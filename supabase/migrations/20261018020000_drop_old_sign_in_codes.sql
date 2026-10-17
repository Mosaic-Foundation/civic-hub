-- Drop the pre-2026-10-13 sign-in code tables and their attempt functions.
-- NOT additive: this deletes three tables and three functions. It ships only
-- with Adam's explicit yes.
--
-- 20261014000000_sign_in_codes.sql moved every sign-in code to sign_in_codes
-- (a hub's) and platform_sign_in_codes (the console's and the start page's)
-- and said a later migration would drop the old three. This is that migration.
-- Nothing in src/ has read or written pending_verifications, control_codes or
-- start_codes since 20261014000000, and nothing calls take_code_attempt,
-- take_control_code_attempt or take_start_code_attempt.
--
-- Pre-checks (dev counted 2026-10-16): pending_verifications 1 row, expired
-- (2026-10-12); control_codes 0; start_codes 0. Re-count on production before
-- applying: none of the three may hold an unexpired row. No view, function or
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
