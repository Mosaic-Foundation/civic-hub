-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social-examples/plugin-straw-poll@0.1.0 passed the conformance suite (257069e). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Not installed on new hubs (auto_install false).

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social-examples/plugin-straw-poll',
  '0.1.0',
  'sha256:fda3bb22bd04dda486b1bc60be75b4d0306f112d03b60d9250f2306e36c88843',
  'Straw polls',
  'straw_poll',
  'example.straw_poll',
  '{"activities":{"emit":["civic.process.submission_received","civic.process.ended","civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["straw_poll_answers"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-26T19:10:57.503Z","commit":"257069e","walked":true}'::jsonb,
  'pending',
  false,
  false
)
ON CONFLICT (package, version, hash) DO NOTHING;
