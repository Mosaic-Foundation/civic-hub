-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-conversation@0.2.0 passed the conformance suite (257069e). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-conversation',
  '0.2.0',
  'sha256:eec2de563080188a8f242498c82bf1b2000c3069487f7793113e5605d41a807e',
  'Conversations',
  'conversation',
  'civic.polis_deliberation',
  '{"activities":{"emit":["civic.process.started","civic.process.ended"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["deliberation_submissions","deliberation_votes","deliberation_drafts"]},"adapters":["deliberation"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-26T19:10:37.197Z","commit":"257069e","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
