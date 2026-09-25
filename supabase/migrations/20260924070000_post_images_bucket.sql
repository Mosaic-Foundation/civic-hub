-- Phase 2c: the post-images bucket is created by a migration, and a hub can
-- only reach objects under its own "<hub_id>/" prefix.
--
-- Until now the bucket existed only because someone made it in the dashboard
-- (20260427100000 says so in a comment), so a fresh stack, a restored dump or
-- a self-hosted copy had no bucket at all. Since Phase 2b every key the app
-- writes starts with the hub's id — <hub_id>/YYYY/MM/… for post images,
-- <hub_id>/identity/YYYY/MM/… for banners and logos — so the first path
-- segment says whose an object is, and the rules below key on it.
--
-- WHO THESE RULES BIND. The app uploads with the service role today, which
-- bypasses row-level security; public reads go through the public bucket URL,
-- which bypasses it too. The policies bind the `authenticated` role, which is
-- what Phase 3's minted hub tokens run as — so they are in place, and tested
-- by that phase's leak harness, before anything relies on them.
--
-- current_hub_id() is the one SQL function Phase 3's policies all call
-- (BUILD-PLAN-multi-tenant.md, Phase 3). It is defined here because these are
-- the first policies that need it; Phase 3 changes where the hub comes from in
-- this one place, if ever.
--
-- PORTABLE. Every step checks for what it needs and skips with a NOTICE when
-- it is absent: on plain Postgres there is no storage schema, and on a stack
-- with storage switched off (supabase/config.toml, locally) neither. The
-- bucket insert is ON CONFLICT DO NOTHING, so the bucket that already exists
-- on the dev and production projects keeps exactly its current settings.
--
-- OBJECTS STORED BEFORE THE PREFIX (YYYY/MM/… and hubs/<hub_id>/…) are not
-- matched by these rules. Nothing reads them through a policy today; the
-- build plan records what the cutover does about them (Phase 2c, "Storage").

CREATE OR REPLACE FUNCTION public.current_hub_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::json ->> 'hub_id'
$$;

COMMENT ON FUNCTION public.current_hub_id() IS
  'The hub the current request is for, from the hub_id claim of its JWT; null without one. Every tenant policy calls this.';

-- Guarded: Supabase's role names; skipped on plain Postgres.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.current_hub_id() TO authenticated, service_role;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'post-images: no storage schema here; bucket and policies skipped';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'post-images',
    'post-images',
    true,                                   -- public read, as it has always been
    5242880,                                -- 5 MB, the cap the upload handler enforces
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'post-images: no authenticated role; policies skipped';
    RETURN;
  END IF;

  -- One policy per operation, each: this bucket, and the first path segment
  -- is the caller's hub. A token with no hub_id matches nothing.
  BEGIN
    DROP POLICY IF EXISTS post_images_hub_read ON storage.objects;
    CREATE POLICY post_images_hub_read ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'post-images' AND (storage.foldername(name))[1] = public.current_hub_id());

    DROP POLICY IF EXISTS post_images_hub_insert ON storage.objects;
    CREATE POLICY post_images_hub_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'post-images' AND (storage.foldername(name))[1] = public.current_hub_id());

    DROP POLICY IF EXISTS post_images_hub_update ON storage.objects;
    CREATE POLICY post_images_hub_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'post-images' AND (storage.foldername(name))[1] = public.current_hub_id())
      WITH CHECK (bucket_id = 'post-images' AND (storage.foldername(name))[1] = public.current_hub_id());

    DROP POLICY IF EXISTS post_images_hub_delete ON storage.objects;
    CREATE POLICY post_images_hub_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'post-images' AND (storage.foldername(name))[1] = public.current_hub_id());
  EXCEPTION WHEN insufficient_privilege THEN
    -- On a hosted project storage.objects may be owned by a role the
    -- migration runner cannot act for. Say so loudly and do not fail the
    -- deploy over rules nothing binds yet; Phase 3's leak harness checks
    -- pg_policies for all four before it turns tokens on.
    RAISE WARNING 'post-images: could not create storage policies (%); create them before Phase 3', SQLERRM;
  END;
END $$;
