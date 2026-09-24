-- Local-only seed data. Runs on `supabase start` and `supabase db reset`.
-- It is NEVER applied by `supabase db push`, so nothing here can reach a
-- hosted project — which is the whole reason the second hub lives here and
-- not in a migration.
--
-- Why a second hub at all: multi-tenancy that is only ever exercised with
-- one tenant is multi-tenancy that is not exercised. Two rows mean the
-- resolver, /api/hub-config and the UI are all developed against a case
-- where picking the wrong hub is visible immediately.

-- `mode` is set HERE, at creation, because it cannot be set later: a trigger
-- on `hubs` refuses any update that moves a hub into demo. That is the rule
-- working as intended — a hub becomes a demo when it is created, or never.
INSERT INTO hubs (id, protocol_hub_id, hostname, name, jurisdiction_code, jurisdiction_name, space_did, mode)
VALUES (
  'athens',
  'civic-hub-athens',
  'athens.localhost',
  'Athens Civic Hub',
  'us-va-athens',
  'Athens, Virginia',
  'did:web:athens.localhost',
  'demo'
)
ON CONFLICT (id) DO NOTHING;
