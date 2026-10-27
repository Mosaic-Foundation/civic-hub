-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-proposal@0.1.1 passed the conformance suite (24471a1+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-proposal',
  '0.1.1',
  'sha256:ebbf6a5c62dbab60bcd3438fa3d80bfe94917f5259a797a19edde9b656c33990',
  'Proposals',
  'proposal',
  'civic.proposal',
  '{"activities":{"emit":["civic.proposal.submitted","civic.proposal.supported","civic.proposal.support_withdrawn","civic.proposal.closed"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["proposals","proposal_supports","proposal_drafts"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-27T05:33:34.212Z","commit":"24471a1+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
