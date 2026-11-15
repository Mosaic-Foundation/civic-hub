-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-announcement@0.3.0 passed the conformance suite (6fe6ffd+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-announcement',
  '0.3.0',
  'sha256:947903220a6810a00c5fdf966d6de26013fab9d69c22089293fb401112fdfb0c',
  'Announcements',
  'announcement',
  'civic.announcement',
  '{"activities":{"emit":["civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":["mail"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-15T22:07:16.724Z","commit":"6fe6ffd+uncommitted","walked":true}'::jsonb,
  'pending',
  false,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
