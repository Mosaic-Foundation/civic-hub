-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-wordcloud@0.3.0 passed the conformance suite (27613ba+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-wordcloud',
  '0.3.0',
  'sha256:1cf24f6d41e44ad7d3595e644a7207adcc77b0e49d343a460c1df0f62db25c45',
  'Word clouds',
  'wordcloud',
  'civic.wordcloud',
  '{"activities":{"emit":["civic.process.started","civic.process.submission_received","civic.process.result_published","civic.process.ended"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["wordcloud_submissions"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-17T02:16:13.363Z","commit":"27613ba+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
