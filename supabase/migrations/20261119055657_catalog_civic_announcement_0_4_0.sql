-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-announcement@0.4.0 passed the conformance suite (6570db3+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-announcement',
  '0.4.0',
  'sha256:9d09ad6dcdd671950a48830114a7f2c5e826f47ed3ae654f040289b8d96ceba1',
  'Announcements',
  'announcement',
  'civic.announcement',
  '{"activities":{"emit":["civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":["mail"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-19T05:56:57.750Z","commit":"6570db3+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
