-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social-examples/plugin-straw-poll@0.1.2 passed the conformance suite (24471a1+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Not installed on new hubs (auto_install false).

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social-examples/plugin-straw-poll',
  '0.1.2',
  'sha256:b651a6f2e0f3ce0e128f104268bad37381c58dee3920216795701883c71c369d',
  'Straw polls',
  'straw_poll',
  'example.straw_poll',
  '{"activities":{"emit":["civic.process.submission_received","civic.process.ended","civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["straw_poll_answers"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-27T05:34:56.979Z","commit":"24471a1+uncommitted","walked":true}'::jsonb,
  'pending',
  false,
  false
)
ON CONFLICT (package, version, hash) DO NOTHING;
