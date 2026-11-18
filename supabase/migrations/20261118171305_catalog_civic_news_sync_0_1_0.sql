-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-news-sync@0.1.0 passed the conformance suite (e6c2660+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-news-sync',
  '0.1.0',
  'sha256:f8ba1c53cdc50a77d0551bf615ad81b44a2b41cb4c80a634b919e420fa772058',
  'News sync',
  'news_sync',
  'civic.news',
  '{"activities":{"emit":["civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","feed-card","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-18T17:13:05.026Z","commit":"e6c2660+uncommitted","walked":false}'::jsonb,
  'pending',
  false,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
