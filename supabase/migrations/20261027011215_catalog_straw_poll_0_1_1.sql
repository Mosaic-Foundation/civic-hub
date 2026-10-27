-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social-examples/plugin-straw-poll@0.1.1 passed the conformance suite (502d1fd+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Not installed on new hubs (auto_install false).

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social-examples/plugin-straw-poll',
  '0.1.1',
  'sha256:8d0436e5c18fac6dba6973dbcf5167355eeb8e6cb1d280faab4e185ba84966e3',
  'Straw polls',
  'straw_poll',
  'example.straw_poll',
  '{"activities":{"emit":["civic.process.submission_received","civic.process.ended","civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["straw_poll_answers"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-27T01:12:15.778Z","commit":"502d1fd+uncommitted","walked":true}'::jsonb,
  'pending',
  false,
  false
)
ON CONFLICT (package, version, hash) DO NOTHING;
