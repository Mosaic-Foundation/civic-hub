-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-brief@0.4.0 passed the conformance suite (5ff98a7+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-brief',
  '0.4.0',
  'sha256:56d62e11daef792ca84e51c434d43506a0c42fb479a879ffa7e50d5eff13208d',
  'Briefs',
  'brief',
  'civic.brief',
  '{"activities":{"emit":["civic.process.aggregation_completed","civic.process.outcome_recorded","civic.process.result_published","civic.process.action_taken"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["brief_responses"]},"adapters":["mail","ai"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-17T05:09:17.638Z","commit":"5ff98a7+uncommitted","walked":false}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
