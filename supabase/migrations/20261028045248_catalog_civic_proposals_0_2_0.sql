-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-proposal@0.2.0 passed the conformance suite (535f7f4+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-proposal',
  '0.2.0',
  'sha256:261b9bc8c77169420d1ecbb2d58735f6a3de5f66da84c01b47f432eb090656d6',
  'Proposals',
  'proposal',
  'civic.proposal',
  '{"activities":{"emit":["civic.proposal.submitted","civic.proposal.supported","civic.proposal.support_withdrawn","civic.proposal.closed"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["proposals","proposal_supports","proposal_drafts"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-28T04:52:48.216Z","commit":"535f7f4+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
