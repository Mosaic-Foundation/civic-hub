-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-wordcloud@0.3.0 passed the conformance suite (896ee02+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-wordcloud',
  '0.3.0',
  'sha256:4f3059db63d45894e6d50470caf5330beca074b10a4d50daa30f39390c6c7567',
  'Word clouds',
  'wordcloud',
  'civic.wordcloud',
  '{"activities":{"emit":["civic.process.started","civic.process.submission_received","civic.process.result_published","civic.process.ended"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["wordcloud_submissions"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","settings-panel"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-17T22:25:05.469Z","commit":"896ee02+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
