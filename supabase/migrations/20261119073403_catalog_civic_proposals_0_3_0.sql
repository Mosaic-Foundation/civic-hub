-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-proposal@0.3.0 passed the conformance suite (0817ce1+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-proposal',
  '0.3.0',
  'sha256:5c44fca5dfcb7bf82d11b6fa1961aa692345eafa6c9bcefa3777ac8f412a9e2e',
  'Proposals',
  'proposal',
  'civic.proposal',
  '{"activities":{"emit":["civic.proposal.submitted","civic.proposal.supported","civic.proposal.support_withdrawn","civic.proposal.closed"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["proposals","proposal_supports","proposal_drafts"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-19T07:34:03.194Z","commit":"0817ce1+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
