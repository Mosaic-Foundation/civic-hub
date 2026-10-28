-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-vote@0.2.0 passed the conformance suite (535f7f4+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-vote',
  '0.2.0',
  'sha256:1f4961b0bd968afa6e7d93702ed3c15661f6c042d99ad5b10f6cc7b0e7b288c7',
  'Votes',
  'vote',
  'civic.vote',
  '{"activities":{"emit":["civic.process.proposed","civic.process.threshold_met","civic.process.started","civic.process.vote_submitted","civic.process.ended","civic.process.aggregation_completed","civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["vote_records","vote_participation","active_vote_keys","vote_drafts"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-28T04:52:37.159Z","commit":"535f7f4+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
