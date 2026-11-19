-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-conversation@0.4.0 passed the conformance suite (df0b1cc+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-conversation',
  '0.4.0',
  'sha256:f5b98ca3b651962866f3abfaed02bdec5d76d670e418446fa651ef9036ef9bee',
  'Conversations',
  'conversation',
  'civic.polis_deliberation',
  '{"activities":{"emit":["civic.process.started","civic.process.ended"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["deliberation_submissions","deliberation_votes","deliberation_drafts"]},"adapters":["deliberation"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-19T04:38:23.605Z","commit":"df0b1cc+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
