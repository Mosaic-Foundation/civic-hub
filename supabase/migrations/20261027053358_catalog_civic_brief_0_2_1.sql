-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-brief@0.2.1 passed the conformance suite (24471a1+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-brief',
  '0.2.1',
  'sha256:78bf64026039b5a95412737746cef499f97da5f3b397df751a55aaf2236f7d27',
  'Briefs',
  'brief',
  'civic.brief',
  '{"activities":{"emit":["civic.process.aggregation_completed","civic.process.outcome_recorded","civic.process.result_published","civic.process.action_taken"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["brief_responses"]},"adapters":["mail","ai"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-27T05:33:58.533Z","commit":"24471a1+uncommitted","walked":false}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
