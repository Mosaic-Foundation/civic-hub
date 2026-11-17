-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-brief@0.4.0 passed the conformance suite (95ef04e+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-brief',
  '0.4.0',
  'sha256:c2411aef03c3da94f6501689d79faa394d19b356ec20e57f2f100ef6ef685929',
  'Briefs',
  'brief',
  'civic.brief',
  '{"activities":{"emit":["civic.process.aggregation_completed","civic.process.outcome_recorded","civic.process.result_published","civic.process.action_taken"],"listen":["process.closed"]},"state":{"read":["own-process"],"write":["own-process"],"tables":["brief_responses"]},"adapters":["mail","ai"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-17T17:26:40.524Z","commit":"95ef04e+uncommitted","walked":false}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
