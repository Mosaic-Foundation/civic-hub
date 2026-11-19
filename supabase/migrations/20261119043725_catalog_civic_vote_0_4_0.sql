-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-vote@0.4.0 passed the conformance suite (df0b1cc+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-vote',
  '0.4.0',
  'sha256:b5d318018c7f113bb83e4e05f9a66c721925772ff9292becb44d637308cd5b17',
  'Votes',
  'vote',
  'civic.vote',
  '{"activities":{"emit":["civic.process.proposed","civic.process.threshold_met","civic.process.started","civic.process.vote_submitted","civic.process.ended","civic.process.aggregation_completed","civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["vote_records","vote_participation","vote_drafts"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-19T04:37:25.013Z","commit":"df0b1cc+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
