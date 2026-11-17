-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-meeting-summary@0.3.0 passed the conformance suite (7b2453b+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-meeting-summary',
  '0.3.0',
  'sha256:35a94cd76be246d4971474ccf1c7edcd5e2e1052698b9baee29e3c51d0253a07',
  'Meeting summaries',
  'meeting_summary',
  'civic.meeting_summary',
  '{"activities":{"emit":["civic.process.aggregation_completed","civic.process.outcome_recorded","civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":["ai","mail","video","web"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","feed-card","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-17T19:45:34.177Z","commit":"7b2453b+uncommitted","walked":false}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
