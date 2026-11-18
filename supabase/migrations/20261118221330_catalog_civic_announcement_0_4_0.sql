-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-announcement@0.4.0 passed the conformance suite (5eb432a+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-announcement',
  '0.4.0',
  'sha256:f19b39a85f368ce5a1263676dfe679d465df08c7cde19528bc9072fc23826e2f',
  'Announcements',
  'announcement',
  'civic.announcement',
  '{"activities":{"emit":["civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":["mail"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-18T22:13:30.926Z","commit":"5eb432a+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
