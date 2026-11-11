-- The console split, step 3c: the stand-ins go. NOT ADDITIVE (drops views and
-- one function); Adam approves before it runs on dev or production.
--
-- 20261111000000 moved the console's seven tables to schema console and left
-- a view under each old name in public, for the code of that moment. Since
-- step 3b the console reads and writes its tables as civic_console, and since
-- step 3c (the release before this one) nothing else reads them through
-- public: the hub's schema check, its hostname check and the operator
-- scripts use console.* or nothing. Release this only once dev and
-- production run that code: the old code's schema check lists these names.
--
-- Dropped: the seven views, and public.take_platform_sign_in_attempt (the
-- wrapper over console.take_platform_sign_in_attempt that the console called
-- through PostgREST before step 3b). The tables, their rows and the console
-- functions are untouched.

DROP VIEW IF EXISTS public.control_sessions;
DROP VIEW IF EXISTS public.control_audit_log;
DROP VIEW IF EXISTS public.platform_sign_in_codes;
DROP VIEW IF EXISTS public.entitlement_links;
DROP VIEW IF EXISTS public.entitlement_redemptions;
DROP VIEW IF EXISTS public.start_sessions;
DROP VIEW IF EXISTS public.entitlements;

DROP FUNCTION IF EXISTS public.take_platform_sign_in_attempt(text, text, text, text, integer);

-- service_role no longer needs the console's tables: the console uses its
-- own login. Taken back, so the hub's key reaches none of the console's data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA console FROM service_role;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA console FROM service_role;
    REVOKE USAGE ON SCHEMA console FROM service_role;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
