-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-news-sync@0.2.0 passed the conformance suite (6570db3+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-news-sync',
  '0.2.0',
  'sha256:eb16fa47c64a926aff3600340f5e783efd019d4f571a2589fb34da79668e3b9f',
  'News sync',
  'news_sync',
  'civic.news',
  '{"activities":{"emit":["civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":["ai","web"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","feed-card","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-19T05:57:11.567Z","commit":"6570db3+uncommitted","walked":false}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
