-- Local-only seed data. Runs on `supabase start` and `supabase db reset`.
-- It is NEVER applied by `supabase db push`, so nothing here can reach a
-- hosted project — which is the whole reason the second hub lives here and
-- not in a migration.
--
-- Why a second hub at all: multi-tenancy that is only ever exercised with
-- one tenant is multi-tenancy that is not exercised. Two rows mean the
-- resolver, /api/hub-config and the UI are all developed against a case
-- where picking the wrong hub is visible immediately.

INSERT INTO hubs (id, hostname, name, jurisdiction_code, jurisdiction_name, space_did)
VALUES (
  'athens',
  'athens.localhost',
  'Athens Civic Hub',
  'us-va-athens',
  'Athens, Virginia',
  'did:web:athens.localhost'
)
ON CONFLICT (id) DO NOTHING;
