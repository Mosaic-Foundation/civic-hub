-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-vote-results@0.1.1 passed the conformance suite (24471a1+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-vote-results',
  '0.1.1',
  'sha256:be4dd4bbe3a1736a5b98081377dffe85ff8ea863b55736e57fbe580021fe252a',
  'Vote results',
  'vote',
  'civic.vote_results',
  '{"activities":{"emit":["civic.process.aggregation_completed","civic.process.outcome_recorded","civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":["mail"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","feed-card"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-27T05:33:51.221Z","commit":"24471a1+uncommitted","walked":false}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
